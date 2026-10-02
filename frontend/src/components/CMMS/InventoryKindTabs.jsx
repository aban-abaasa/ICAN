import React from 'react';
import { Package, Wrench, Boxes } from 'lucide-react';
import { formatMoney } from '../../services/cmmsAssetLedgerService';

// Classic segmented switch: everything in the store room, split the way the
// books split it. Assets are held and depreciated; consumables are used up or resold.
export default function InventoryKindTabs({ value, onChange, counts, values, currency = 'UGX' }) {
  const tabs = [
    { id: 'all', label: 'Everything', icon: Boxes, count: counts.all, amount: values.all },
    { id: 'asset', label: 'Assets', icon: Wrench, count: counts.asset, amount: values.asset, sub: 'net book value' },
    { id: 'consumable', label: 'Consumables', icon: Package, count: counts.consumable, amount: values.consumable, sub: 'stock value' }
  ];
  return (
    <div role="tablist" aria-label="Inventory kind" className="grid grid-cols-3 gap-2">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = value === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={`rounded-lg border px-3 py-2 text-left transition ${
              active ? 'border-amber-400 bg-amber-500/15' : 'border-white border-opacity-15 bg-white bg-opacity-5 hover:border-opacity-40'
            }`}
          >
            <span className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${active ? 'text-amber-200' : 'text-gray-300'}`}>
              <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {tab.label}
            </span>
            <span className="mt-1 block text-lg font-bold text-white">{tab.count}</span>
            <span className="block truncate text-[11px] text-gray-400">
              {tab.id === 'all' ? 'items' : `${formatMoney(tab.amount, currency)} ${tab.sub}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}
