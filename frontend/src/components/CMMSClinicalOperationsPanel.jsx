import React, { useState } from 'react';
import { Briefcase, ClipboardList, FileText } from 'lucide-react';
import CMMSOperationsPanel from './CMMSOperationsPanel';
import CMMSConsultationForms from './CMMSConsultationForms';
import CMMSClinicalRecords from './CMMSClinicalRecords';

// Clinical Operations used to be just CMMSOperationsPanel's generic
// activity log (handovers, incidents, equipment checks) rendered directly
// under the 'clinical' tab. This wraps it with two more sub-tabs —
// Consultation Forms (the form builder + per-form submissions) and Records
// (every submission across every form, in one searchable place) — so all
// three live together under one Clinical Operations module instead of
// being disconnected features bolted on elsewhere. The activity log's own
// businessProfileId/mode plumbing is untouched; this only adds tabs around it.
const TABS = [
  { id: 'log', label: 'Activity Log', icon: ClipboardList },
  { id: 'forms', label: 'Consultation Forms', icon: Briefcase },
  { id: 'records', label: 'Records', icon: FileText }
];

export default function CMMSClinicalOperationsPanel({ businessProfileId, businessName }) {
  const [tab, setTab] = useState('log');

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-white/10">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === id ? 'border-cyan-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'log' && <CMMSOperationsPanel businessProfileId={businessProfileId} mode="clinical" />}
      {tab === 'forms' && <CMMSConsultationForms businessProfileId={businessProfileId} businessName={businessName} />}
      {tab === 'records' && <CMMSClinicalRecords businessProfileId={businessProfileId} businessName={businessName} />}
    </div>
  );
}
