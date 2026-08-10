import { useEffect, useState } from 'react';
import { ArrowRight, Building2, Factory, GraduationCap, HeartPulse, Hotel, Landmark, Scale, Store, Truck, X } from 'lucide-react';
import { getBusinessCategoryTemplates } from '../services/businessManagementService';

const FALLBACK_CATEGORIES = [
  ['retail', 'Retail', 'Stores, shops, and direct-to-customer businesses.', Store],
  ['wholesale', 'Wholesale', 'Bulk sales and distribution businesses.', Truck],
  ['factory', 'Factory / Manufacturing', 'Production, machinery, inventory, and maintenance.', Factory],
  ['supplier', 'Supplier / Raw Materials', 'Businesses selling goods, materials, or services to other businesses.', Building2],
  ['restaurant', 'Restaurant / Hospitality', 'Restaurants, hotels, catering, and hospitality.', Hotel],
  ['pharmacy', 'Pharmacy', 'Pharmacies and health-product retailers.', HeartPulse],
  ['school', 'School', 'Schools and education organisations.', GraduationCap],
  ['hospital', 'Hospital / Clinic', 'Clinical, healthcare, and medical organisations.', HeartPulse],
  ['construction', 'Construction', 'Construction companies, projects, sites, and equipment.', Factory],
  ['government', 'Government / Infrastructure', 'Public institutions and infrastructure programmes.', Landmark],
  ['law_firm', 'Law Firm', 'Legal practices and client matters.', Scale],
  ['professional_services', 'Professional Services', 'Consultancies and other service businesses.', Building2],
  ['other', 'Other Organisation', 'Any other organisation or company.', Building2],
].map(([category_key, display_name, description, Icon]) => ({ category_key, display_name, description, Icon }));

const BusinessCategorySelector = ({ onSelect, onCancel }) => {
  const [categories, setCategories] = useState(FALLBACK_CATEGORIES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getBusinessCategoryTemplates().then(({ data }) => {
      if (!active || !data?.length) return;
      setCategories(data.map((category) => ({
        ...category,
        Icon: category.category_key === 'factory' ? Factory : category.category_key === 'retail' ? Store : Building2,
        description: category.operating_mode === 'enterprise'
          ? 'Enterprise workflows, approvals, and reporting.'
          : 'Business management, inventory, and reporting tools.'
      })));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl border border-indigo-400/30 bg-slate-950 p-5 shadow-2xl sm:rounded-3xl sm:p-7">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">Pichin business profile</p>
            <h2 className="text-2xl font-bold text-white">Choose your company type</h2>
            <p className="mt-2 text-sm text-slate-400">This helps us prepare the right business tools and CMMS workspace for you.</p>
          </div>
          <button onClick={onCancel} className="rounded-full p-2 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Close"><X size={20} /></button>
        </div>
        {loading && <p className="mb-3 text-xs text-slate-500">Loading available business types…</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {categories.map(({ category_key, display_name, description, Icon }) => (
            <button key={category_key} onClick={() => onSelect({ category_key, display_name })} className="group flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-left transition hover:border-indigo-400/60 hover:bg-indigo-500/10">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300"><Icon size={22} /></span>
              <span className="min-w-0 flex-1"><span className="block font-semibold text-white">{display_name}</span><span className="mt-1 block text-xs leading-5 text-slate-400">{description}</span></span>
              <ArrowRight size={18} className="shrink-0 text-slate-600 transition group-hover:translate-x-1 group-hover:text-indigo-300" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default BusinessCategorySelector;
