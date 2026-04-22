import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Stethoscope } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { FilterTabs } from '../components/ui/FilterTabs';
import { PatientLookupPanel } from '../components/admin/drchrono/PatientLookupPanel';
import { BatchLookupPanel } from '../components/admin/drchrono/BatchLookupPanel';
import { AdminDrChronoPage as DrChronoSetupPanel } from './AdminDrChronoPage';

type Tab = 'patient-lookup' | 'batch-lookup' | 'setup';

const TAB_META: Record<Tab, { label: string; subtitle: string }> = {
  'patient-lookup': {
    label: 'Patient Lookup',
    subtitle: 'Find a patient in DrChrono by name, email, phone, or chart ID and see their full profile.',
  },
  'batch-lookup': {
    label: 'Batch Lookup',
    subtitle: 'Paste a list of patients, one per line. Each row resolves into a unified DrChrono summary.',
  },
  'setup': {
    label: 'Setup',
    subtitle: 'Configure DrChrono OAuth credentials, practice subdomain, and enable/disable the integration.',
  },
};

export const AdminDrChronoHubPage: React.FC = () => {
  const [params, setParams] = useSearchParams();

  const hasPatientParams =
    params.has('firstName') || params.has('lastName') || params.has('drchronoId');
  const urlTab = params.get('tab');
  const initial: Tab = hasPatientParams
    ? 'patient-lookup'
    : urlTab === 'batch-lookup' || urlTab === 'setup' || urlTab === 'patient-lookup'
      ? urlTab
      : 'patient-lookup';

  const [tab, setTab] = useState<Tab>(initial);

  function switchTab(next: string) {
    const t = (next === 'batch-lookup' || next === 'setup' ? next : 'patient-lookup') as Tab;
    setTab(t);
    const nextParams = new URLSearchParams(params);
    if (t === 'patient-lookup') nextParams.delete('tab');
    else nextParams.set('tab', t);
    nextParams.delete('job');
    nextParams.delete('firstName');
    nextParams.delete('lastName');
    nextParams.delete('drchronoId');
    setParams(nextParams, { replace: true });
  }

  const meta = TAB_META[tab];

  return (
    <div className="space-y-6">
      <PageHeader
        backTo="/admin"
        icon={Stethoscope}
        title="DrChrono"
        subtitle={meta.subtitle}
      />

      <FilterTabs
        activeKey={tab}
        onChange={switchTab}
        tabs={[
          { key: 'patient-lookup', label: TAB_META['patient-lookup'].label },
          { key: 'batch-lookup', label: TAB_META['batch-lookup'].label },
          { key: 'setup', label: TAB_META['setup'].label },
        ]}
      />

      {tab === 'patient-lookup' && <PatientLookupPanel />}
      {tab === 'batch-lookup' && <BatchLookupPanel />}
      {tab === 'setup' && <DrChronoSetupPanel />}
    </div>
  );
};
