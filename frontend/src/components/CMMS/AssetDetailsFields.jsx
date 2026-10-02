import React from 'react';
import {
  ASSET_CONDITIONS,
  ASSET_STATUSES,
  DEPRECIATION_METHODS,
  accumulatedDepreciation,
  formatMoney
} from '../../services/cmmsAssetLedgerService';

const field = 'w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm disabled:opacity-50';
const label = 'text-xs text-gray-300';

export const emptyAssetDetails = () => ({
  acquisition_year: new Date().getFullYear(),
  acquisition_date: '',
  manufacture_year: '',
  useful_life_years: 5,
  salvage_value: 0,
  depreciation_method: 'straight_line',
  serial_number: '',
  asset_tag: '',
  manufacturer: '',
  model: '',
  asset_condition: 'good',
  asset_status: 'in_service',
  warranty_expiry: ''
});

/** Pull the asset fields out of an inventory row into form state. */
export const assetDetailsFromItem = (item = {}) => ({
  ...emptyAssetDetails(),
  acquisition_year: item.acquisition_year ?? new Date().getFullYear(),
  acquisition_date: item.acquisition_date || '',
  manufacture_year: item.manufacture_year ?? '',
  useful_life_years: item.useful_life_years ?? 5,
  salvage_value: item.salvage_value ?? 0,
  depreciation_method: item.depreciation_method || 'straight_line',
  serial_number: item.serial_number || '',
  asset_tag: item.asset_tag || '',
  manufacturer: item.manufacturer || '',
  model: item.model || '',
  asset_condition: item.asset_condition || 'good',
  asset_status: item.asset_status === 'disposed' ? 'in_service' : (item.asset_status || 'in_service'),
  warranty_expiry: item.warranty_expiry || ''
});

/**
 * Asset-only fields. `cost` is the per-unit acquisition cost the parent form
 * already collects as Unit Cost. Controlled: value / onChange(partial).
 */
export default function AssetDetailsFields({ value, onChange, cost = 0, quantity = 1, currency = 'UGX', disabled = false }) {
  const set = (key) => (event) => onChange({ ...value, [key]: event.target.value });
  const thisYear = new Date().getFullYear();
  const owned = Number(value.acquisition_year) > 0 && Number(value.acquisition_year) < thisYear;

  const perUnitAcc = accumulatedDepreciation({
    cost,
    salvage: value.salvage_value,
    lifeYears: value.useful_life_years,
    method: value.depreciation_method,
    acquisitionYear: value.acquisition_year
  }, thisYear);
  const nbv = Math.max(0, (Number(cost) || 0) - perUnitAcc) * (Number(quantity) || 0);

  return (
    <div className="space-y-3 rounded-lg border border-white border-opacity-10 bg-white bg-opacity-5 p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">Asset details</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <label className={label}>Year acquired</label>
          <input type="number" min="1900" max={thisYear + 1} value={value.acquisition_year} onChange={set('acquisition_year')} disabled={disabled} className={field} />
          <p className="text-[11px] text-gray-400">
            {owned ? 'Already owned: recorded in that year’s books, no money leaves the wallet today.' : 'Bought this year: recorded as a purchase today.'}
          </p>
        </div>
        <div className="space-y-1">
          <label className={label}>Exact purchase date <span className="text-gray-500">(optional)</span></label>
          <input type="date" value={value.acquisition_date} onChange={set('acquisition_date')} disabled={disabled} className={field} />
        </div>
        <div className="space-y-1">
          <label className={label}>Year manufactured <span className="text-gray-500">(optional)</span></label>
          <input type="number" min="1800" max={thisYear + 1} value={value.manufacture_year} onChange={set('manufacture_year')} disabled={disabled} className={field} />
        </div>
        <div className="space-y-1">
          <label className={label}>Useful life (years)</label>
          <input type="number" min="1" max="100" value={value.useful_life_years} onChange={set('useful_life_years')} disabled={disabled} className={field} />
        </div>
        <div className="space-y-1">
          <label className={label}>Depreciation</label>
          <select value={value.depreciation_method} onChange={set('depreciation_method')} disabled={disabled} className={field}>
            {DEPRECIATION_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className={label}>Salvage value per unit</label>
          <input type="number" min="0" value={value.salvage_value} onChange={set('salvage_value')} disabled={disabled} className={field} />
        </div>
        <div className="space-y-1">
          <label className={label}>Serial number</label>
          <input type="text" value={value.serial_number} onChange={set('serial_number')} disabled={disabled} className={field} />
        </div>
        <div className="space-y-1">
          <label className={label}>Asset tag</label>
          <input type="text" value={value.asset_tag} onChange={set('asset_tag')} disabled={disabled} placeholder="e.g. KLA-0042" className={field} />
        </div>
        <div className="space-y-1">
          <label className={label}>Manufacturer</label>
          <input type="text" value={value.manufacturer} onChange={set('manufacturer')} disabled={disabled} className={field} />
        </div>
        <div className="space-y-1">
          <label className={label}>Model</label>
          <input type="text" value={value.model} onChange={set('model')} disabled={disabled} className={field} />
        </div>
        <div className="space-y-1">
          <label className={label}>Condition</label>
          <select value={value.asset_condition} onChange={set('asset_condition')} disabled={disabled} className={field}>
            {ASSET_CONDITIONS.map((condition) => <option key={condition} value={condition}>{condition[0].toUpperCase() + condition.slice(1)}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className={label}>Status</label>
          <select value={value.asset_status} onChange={set('asset_status')} disabled={disabled} className={field}>
            {ASSET_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className={label}>Warranty expires <span className="text-gray-500">(optional)</span></label>
          <input type="date" value={value.warranty_expiry} onChange={set('warranty_expiry')} disabled={disabled} className={field} />
        </div>
      </div>
      {Number(cost) > 0 && value.depreciation_method !== 'none' && (
        <p className="text-xs text-gray-300">
          Net book value today: <span className="font-semibold text-green-300">{formatMoney(nbv, currency)}</span>
          <span className="text-gray-500"> · depreciated {formatMoney(perUnitAcc * (Number(quantity) || 0), currency)} so far</span>
        </p>
      )}
    </div>
  );
}
