import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, FileCheck2, Rocket, ShoppingBag, Store } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useTheme, isDarkFamilyTheme } from '../../../context/ThemeContext';
import { insuranceService, isNotInstalled, listMyBusinesses } from '../../../services/insuranceService';
import { Alert, useLocalRate } from '../common';
import InsurerApplication from '../InsurerApplication';
import InsurerDesk, { Register } from '../InsurerDesk';
import InsurerPlans from '../InsurerPlans';
import GetListed from './GetListed';
import ListingEditor from './ListingEditor';
import '../../profile/growth/growth.css';
import '../insurance.css';

/**
 * The insurance partner console, the insurer's counterpart of the franchise console. One place to go from
 * "I run an insurance company" to "customers can find and buy from me": apply with your licence, register your
 * business, build a public listing with a live preview, put plans on sale with a coach, and then run policies
 * and claims. Reads and writes only through the insurance RPCs.
 */
export default function InsurerPartnerPanel() {
  const { user } = useAuth();
  const { actualTheme } = useTheme();
  const dark = isDarkFamilyTheme(actualTheme);
  const rate = useLocalRate(user?.id);

  const [insurers, setInsurers] = useState(null);   // null = loading
  const [applications, setApplications] = useState([]);
  const [businesses, setBusinesses] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [plans, setPlans] = useState(null);
  const [tab, setTab] = useState('listed');
  const [installed, setInstalled] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [mine, apps, biz] = await Promise.all([
        insuranceService.myInsurers(),
        insuranceService.myApplications().catch(() => []),
        user?.id ? listMyBusinesses(user.id) : Promise.resolve([]),
      ]);
      setInsurers(mine || []);
      setApplications(apps || []);
      setBusinesses(biz || []);
      setSelectedId((id) => ((mine || []).some((i) => i.insurer_id === id) ? id : (mine || [])[0]?.insurer_id || null));
      setError('');
    } catch (e) {
      if (isNotInstalled(e)) setInstalled(false); else setError(e.message);
      setInsurers([]);
    }
  }, [user?.id]);
  useEffect(() => { load(); }, [load]);

  const insurer = useMemo(() => (insurers || []).find((i) => i.insurer_id === selectedId) || null, [insurers, selectedId]);

  const loadPlans = useCallback(async () => {
    if (!selectedId) { setPlans([]); return; }
    try { setPlans(await insuranceService.insurerPlans(selectedId)); } catch { setPlans([]); }
  }, [selectedId]);
  useEffect(() => { setPlans(null); loadPlans(); }, [loadPlans]);

  const goTab = (t) => { setTab(t); if (typeof window !== 'undefined') window.scrollTo?.({ top: 0, behavior: 'smooth' }); };
  const reloadAll = () => { load(); loadPlans(); };

  const has = Boolean(insurer);
  const tabs = [
    { id: 'listed', label: 'Get listed', Icon: Rocket },
    ...(has ? [{ id: 'listing', label: 'My listing', Icon: Store }, { id: 'plans', label: 'Plans', Icon: ShoppingBag }] : []),
    { id: 'apply', label: 'Applications', Icon: FileCheck2 },
    ...(has ? [{ id: 'desk', label: 'Policies & claims', Icon: BarChart3 }] : []),
  ];
  const active = tabs.some((t) => t.id === tab) ? tab : 'listed';

  return (
    <section className="gr ip" aria-label="Insurance partner">
      <article className="gr-card gr-form">
        <div>
          <p className="gr-eyebrow">Insurance partners</p>
          <h3 className="gr-title gr-h">Sell insurance on IcanEra</h3>
          <p className="gr-sub" style={{ marginTop: 6 }}>
            Licensed insurers get a verified public listing, customers who pay in ICAN straight into the business wallet, and one place to manage plans, policies and claims.
          </p>
        </div>
        {(insurers || []).length > 1 && (
          <div className="gr-field"><label className="gr-label" htmlFor="ip-insurer">Insurer</label>
            <select id="ip-insurer" className="gr-select" value={selectedId || ''} onChange={(e) => setSelectedId(e.target.value)}>
              {insurers.map((i) => <option key={i.insurer_id} value={i.insurer_id}>{i.display_name} · {i.licence_number} ({i.country_code})</option>)}
            </select></div>
        )}
        <div className="ins-nav" role="tablist" aria-label="Insurance partner sections">
          {tabs.map(({ id, label, Icon }) => (
            <button key={id} type="button" role="tab" aria-pressed={active === id} onClick={() => goTab(id)}><Icon aria-hidden="true" />{label}</button>
          ))}
        </div>
      </article>

      {!installed && <Alert tone="warn">Insurance is not switched on for this server yet. An administrator needs to run the insurance migration (ADD_INSURANCE_PLATFORM.sql).</Alert>}
      {error && <Alert tone="bad">{error}</Alert>}
      {installed && insurer && !('listed' in insurer) && (
        <Alert tone="warn">Public listings are not switched on for this server yet. An administrator needs to run the insurer listings SQL (Part 4). You can still sell, but the listing and directory will not work.</Alert>
      )}
      {installed && insurers === null && (<><div className="gr-skel" aria-hidden="true" /><div className="gr-skel" aria-hidden="true" /></>)}

      {installed && insurers && (
        <>
          {active === 'listed' && <GetListed insurer={insurer} plans={plans || []} applications={applications} goTab={goTab} />}
          {active === 'listing' && insurer && <ListingEditor insurer={insurer} plans={plans || []} dark={dark} onSaved={reloadAll} />}
          {active === 'plans' && insurer && <InsurerPlans key={insurer.insurer_id} insurer={insurer} rate={rate} onChanged={loadPlans} />}
          {active === 'apply' && (
            <div className="gr-form">
              <section className="gr-card gr-form">
                <div>
                  <p className="gr-eyebrow">{has ? 'Another licence or country' : 'Step 1'}</p>
                  <h3 className="gr-title gr-h">Apply with your licence</h3>
                  <p className="gr-sub" style={{ marginTop: 6 }}>Support checks each licence once. A company with more than one licence, or licensed in more than one country, applies for each.</p>
                </div>
                <InsurerApplication dark={dark} />
              </section>
              <Register businesses={businesses} onDone={reloadAll} />
            </div>
          )}
          {active === 'desk' && insurer && <InsurerDesk businesses={businesses} insurers={insurers} rate={rate} onReload={reloadAll} />}
        </>
      )}
    </section>
  );
}
