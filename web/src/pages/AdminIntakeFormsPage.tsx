import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useSimulationMode } from '../hooks/useSimulationMode';
import { useFeatures } from '../hooks/useFeatures';
import { isAdminRole } from '../lib/roles';
import { intakeFormOperations, prescriptionRefillOperations } from '../lib/firestore';
import { PatientIntakeForm } from '../types';
import {
  FileText,
  Check,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  User,
  RefreshCw,
} from 'lucide-react';
import { FormDataViewer } from '../components/intake/IntakeFormDisplay';
import { SendBackIntakeFormModal } from '../components/intake/SendBackIntakeFormModal';
import { AdminGuard } from '../components/ui/AdminGuard';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { PageHeader } from '../components/ui/PageHeader';
import { FilterTabs } from '../components/ui/FilterTabs';
import { EmptyState } from '../components/ui/EmptyState';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { Button } from '../components/ui/Button';
import { PaginationBar } from '../components/ui/PaginationBar';
import { formatDate } from '../lib/date-helpers';
import { usePagedCollection, type WhereClause } from '../hooks/usePagedCollection';
import { useCollectionCounts } from '../hooks/useCollectionCounts';
import logger from '../lib/logger';

const ADMIN_STATUSES = ['completed', 'approved', 'in_progress'] as const;

const SECTION_LABELS: Record<string, string> = {
  patientInfo: 'Patient Information',
  medicalHistory: 'Medical History',
  consentForm: 'Consent Forms',
  conciergeAgreement: 'Concierge Agreement',
};


export const AdminIntakeFormsPage: React.FC = () => {
  const { user, userProfile } = useAuth();
  const { enabled: simulated } = useSimulationMode();
  const { features } = useFeatures();
  const isAdminUser = !!user && isAdminRole(userProfile?.role);
  const [patientNames, setPatientNames] = useState<Record<string, { firstName: string; lastName: string }>>({});
  const [filter, setFilter] = useState<'all' | 'completed' | 'in_progress' | 'approved'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [approveConfirmId, setApproveConfirmId] = useState<string | null>(null);
  const [sendBackId, setSendBackId] = useState<string | null>(null);
  const [sendBackNotes, setSendBackNotes] = useState('');

  const whereClauses = useMemo<WhereClause[] | undefined>(
    () => filter === 'all'
      ? [['status', 'in', [...ADMIN_STATUSES]]]
      : [['status', '==', filter]],
    [filter],
  );

  const paged = usePagedCollection<PatientIntakeForm>({
    enabled: isAdminUser,
    real: 'patient-intake-forms',
    orderField: 'updatedAt',
    pageSize: 10,
    whereClauses,
    mapDoc: (d) => ({ ...(d.data() as PatientIntakeForm), id: d.id }),
  });
  const filtered = paged.rows;
  const loading = paged.loading;

  const countsPredicates = useMemo(() => ({
    all: [['status', 'in', [...ADMIN_STATUSES]]] as [string, 'in', string[]][],
    completed: [['status', '==', 'completed']] as [string, '==', string][],
    in_progress: [['status', '==', 'in_progress']] as [string, '==', string][],
    approved: [['status', '==', 'approved']] as [string, '==', string][],
  }), []);
  const { counts: statusCounts, refresh: refreshCounts } = useCollectionCounts({
    enabled: isAdminUser,
    real: 'patient-intake-forms',
    predicates: countsPredicates,
  });

  // Fetch names only for patients on the current page. Memoizing the missing
  // ids keeps the effect from re-firing on every render — without this, the
  // setPatientNames inside the effect retriggers the next render which
  // rebuilds `filtered` and we'd refetch the same ids over and over.
  const idsToFetchKey = useMemo(
    () => [...new Set(filtered.map((f) => f.patientId))]
      .filter((id) => !(id in patientNames))
      .sort()
      .join(','),
    [filtered, patientNames],
  );
  useEffect(() => {
    if (!idsToFetchKey) return;
    const ids = idsToFetchKey.split(',');
    prescriptionRefillOperations.getPatientNamesByIds(ids, simulated).then((res) => {
      if (res.success && res.data) {
        setPatientNames((prev) => ({ ...prev, ...res.data }));
      }
    }).catch((err) => logger.error('patient-name lookup failed', err));
  }, [idsToFetchKey, simulated]);

  const refreshAll = () => { paged.refresh(); refreshCounts(); };

  const handleApprove = async (formId: string) => {
    if (!user) return;
    try {
      await intakeFormOperations.approveIntakeForm(formId, user.uid);
      refreshAll();
    } catch (error) {
      logger.error('Error approving form:', error);
    }
    setApproveConfirmId(null);
  };

  const handleSendBack = async (formId: string) => {
    if (!user) return;
    try {
      await intakeFormOperations.sendBackIntakeForm(formId, user.uid, sendBackNotes || undefined);
      setSendBackNotes('');
      refreshAll();
    } catch (error) {
      logger.error('Error sending back form:', error);
    }
    setSendBackId(null);
  };

  const getStatusColorClass = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-yellow-100 text-yellow-800';
      case 'approved': return 'bg-green-100 text-green-800';
      case 'in_progress': return 'bg-blue-100 text-blue-800';
      default: return 'bg-secondary-100 text-secondary-800';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'completed': return 'Submitted';
      case 'approved': return 'Accepted';
      case 'in_progress': return 'In Progress';
      case 'draft': return 'Draft';
      default: return status;
    }
  };

  // Honor the same feature flag the sidebar uses — without this, an admin
  // could deeplink to /admin/intake-forms even when the practice has the
  // feature off in fork.config.ts / branding.
  if (!features.patientIntake) {
    return (
      <AdminGuard>
        <div className="space-y-6">
          <EmptyState
            icon={FileText}
            title="Intake forms are disabled"
            description="Enable the patientIntake feature to use this page."
          />
        </div>
      </AdminGuard>
    );
  }

  return (
    <AdminGuard>
    <div className="space-y-6">
      <PageHeader
        backTo="/admin"
        title="Intake Forms"
        subtitle="Review and approve patient intake forms"
        icon={FileText}
      />

      <FilterTabs
        tabs={[
          { key: 'all', label: 'All', count: statusCounts.all },
          { key: 'completed', label: 'Submitted', count: statusCounts.completed },
          { key: 'in_progress', label: 'In Progress', count: statusCounts.in_progress },
          { key: 'approved', label: 'Accepted', count: statusCounts.approved },
        ]}
        activeKey={filter}
        onChange={(f) => setFilter(f as typeof filter)}
      />

      <div className="flex justify-end">
        <Button onClick={refreshAll} loading={loading} variant="secondary" size="sm">
          <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
        </Button>
      </div>

      {loading && filtered.length === 0 && paged.page === 1 ? (
        <LoadingSpinner />
      ) : (
      <div className={`transition-opacity duration-150 ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
      {filtered.length === 0 && !loading ? (
        <EmptyState
          icon={FileText}
          title="No intake forms"
          description={filter === 'all' ? 'No patients have started intake forms yet.' : `No forms with status "${getStatusLabel(filter)}".`}
        />
      ) : (
        <>
        <div className="space-y-3">
          {filtered.map((form) => {
            const name = patientNames[form.patientId];
            const patientName = name ? `${name.firstName} ${name.lastName}` : form.patientId;
            const isExpanded = expandedId === form.id;
            const sectionsComplete = form.completedSections?.length || 0;

            return (
              <div key={form.id} className="bg-surface-card border border-secondary-200 rounded-lg overflow-hidden">
                {/* Header row */}
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-secondary-50 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : form.id)}
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className="p-2 bg-purple-100 rounded-lg flex-shrink-0">
                      <User className="h-4 w-4 text-purple-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-secondary-900 truncate">{patientName}</p>
                      <p className="text-xs text-secondary-500">
                        {sectionsComplete}/4 sections
                        {form.updatedAt && ` · Updated ${formatDate(form.updatedAt)}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3 flex-shrink-0">
                    <StatusBadge label={getStatusLabel(form.status)} colorClass={getStatusColorClass(form.status)} />
                    {isExpanded ? <ChevronUp className="h-4 w-4 text-secondary-400" /> : <ChevronDown className="h-4 w-4 text-secondary-400" />}
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-secondary-100">
                    {/* Sections checklist */}
                    <div className="grid grid-cols-2 gap-2 mt-3 mb-4">
                      {Object.entries(SECTION_LABELS).map(([key, label]) => {
                        const done = form.completedSections?.includes(key);
                        return (
                          <div key={key} className="flex items-center space-x-2">
                            <div className={`w-4 h-4 rounded-full flex items-center justify-center ${done ? 'bg-green-100' : 'bg-secondary-100'}`}>
                              {done && <Check className="h-3 w-3 text-green-600" />}
                            </div>
                            <span className={`text-sm ${done ? 'text-secondary-900' : 'text-secondary-400'}`}>{label}</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Form data viewer */}
                    <div className="mb-4">
                      <FormDataViewer form={form} />
                    </div>

                    {/* Review notes */}
                    {form.reviewNotes && (
                      <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <p className="text-xs font-medium text-amber-800 mb-1">Review Notes</p>
                        <p className="text-sm text-amber-700">{form.reviewNotes}</p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex space-x-2">
                      {form.status === 'completed' && (
                        <>
                          <button
                            onClick={() => setApproveConfirmId(form.id)}
                            className="flex items-center space-x-1.5 px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
                          >
                            <Check className="h-3.5 w-3.5" />
                            <span>Accept</span>
                          </button>
                          <button
                            onClick={() => setSendBackId(form.id)}
                            className="flex items-center space-x-1.5 px-3 py-1.5 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 transition-colors"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            <span>Send Back</span>
                          </button>
                        </>
                      )}
                      {form.status === 'approved' && (
                        <span className="text-sm text-green-600 font-medium flex items-center space-x-1">
                          <Check className="h-4 w-4" />
                          <span>Accepted{form.approvedAt && ` on ${formatDate(form.approvedAt)}`}</span>
                        </span>
                      )}
                      {form.status === 'in_progress' && (
                        <span className="text-sm text-secondary-500">Patient is still working on this form</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <PaginationBar
          currentPage={paged.page}
          pageSize={paged.pageSize}
          totalItems={(paged.page - 1) * paged.pageSize + filtered.length + (paged.hasNext ? 1 : 0)}
          hasMore={paged.hasNext}
          onPreviousPage={paged.prev}
          onNextPage={paged.next}
          label="intake forms"
        />
        </>
      )}
      </div>
      )}

      {/* Approve confirmation */}
      <ConfirmModal
        isOpen={!!approveConfirmId}
        title="Accept Intake Form"
        message="This will mark the patient's intake forms as accepted. Are you sure?"
        confirmLabel="Accept"
        variant="info"
        onConfirm={() => approveConfirmId && handleApprove(approveConfirmId)}
        onClose={() => setApproveConfirmId(null)}
      />

      <SendBackIntakeFormModal
        formId={sendBackId}
        notes={sendBackNotes}
        onNotesChange={setSendBackNotes}
        onConfirm={handleSendBack}
        onClose={() => { setSendBackId(null); setSendBackNotes(''); }}
      />
    </div>
    </AdminGuard>
  );
};
