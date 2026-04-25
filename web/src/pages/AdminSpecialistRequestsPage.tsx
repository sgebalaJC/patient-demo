import React, { useState, useEffect, useMemo } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useAuth } from '../hooks/useAuth';
import { useSimulationMode } from '../hooks/useSimulationMode';
import { isAdminRole } from '../lib/roles';
import {
  specialistRequestOperations,
  prescriptionRefillOperations,
} from '../lib/firestore';
import { SpecialistRequest } from '../types';
import {
  Stethoscope,
  Clock,
  User,
  CheckCircle,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { AdminGuard } from '../components/ui/AdminGuard';
import { PageHeader } from '../components/ui/PageHeader';
import { StatsGrid } from '../components/ui/StatsGrid';
import { FilterTabs } from '../components/ui/FilterTabs';
import { PaginationBar } from '../components/ui/PaginationBar';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { getSpecialistLabel } from '../config/specialists';
import { formatDate } from '../lib/date-helpers';
import { usePagedCollection, type WhereClause } from '../hooks/usePagedCollection';
import { useCollectionCounts } from '../hooks/useCollectionCounts';
import logger from '../lib/logger';
import {
  ConfirmSpecialistAppointmentModal,
  type RequestWithPatient,
} from '../components/appointments/ConfirmSpecialistAppointmentModal';

export const AdminSpecialistRequestsPage: React.FC = () => {
  const { user, userProfile } = useAuth();
  const { enabled: simulated } = useSimulationMode();
  const isAdminUser = !!user && isAdminRole(userProfile?.role);
  const [filter, setFilter] = useState<'all' | 'pending' | 'confirmed' | 'cancelled'>('pending');
  const [patientNames, setPatientNames] = useState<Record<string, { firstName: string; lastName: string }>>({});

  // Confirm modal target — null means closed. Form state, Google Places
  // wiring, and the create-appointment Firestore writes live inside the
  // modal component.
  const [confirmingRequest, setConfirmingRequest] = useState<RequestWithPatient | null>(null);
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);

  const whereClauses = useMemo<WhereClause[] | undefined>(
    () => (filter === 'all' ? undefined : [['status', '==', filter]]),
    [filter],
  );

  const paged = usePagedCollection<SpecialistRequest>({
    enabled: isAdminUser,
    real: 'specialist-requests',
    orderField: 'createdAt',
    pageSize: 10,
    whereClauses,
    mapDoc: (d) => ({ ...(d.data() as SpecialistRequest), id: d.id }),
  });
  const loading = paged.loading;

  const countsPredicates = useMemo(() => ({
    all: [] as [string, '==', string][],
    pending: [['status', '==', 'pending']] as [string, '==', string][],
    confirmed: [['status', '==', 'confirmed']] as [string, '==', string][],
    cancelled: [['status', '==', 'cancelled']] as [string, '==', string][],
  }), []);
  const { counts: statusCounts, refresh: refreshCounts } = useCollectionCounts({
    enabled: isAdminUser,
    real: 'specialist-requests',
    predicates: countsPredicates,
  });

  // Fetch names only for patients on the current page.
  useEffect(() => {
    const ids = [...new Set(paged.rows.map((r) => r.patientId))].filter(
      (id) => !(id in patientNames),
    );
    if (ids.length === 0) return;
    prescriptionRefillOperations.getPatientNamesByIds(ids, simulated).then((res) => {
      if (res.success && res.data) {
        setPatientNames((prev) => ({ ...prev, ...res.data }));
      }
    }).catch((err) => logger.error('patient-name lookup failed', err));
  }, [paged.rows, patientNames, simulated]);

  const requestsPage: RequestWithPatient[] = paged.rows.map((r) => {
    const n = patientNames[r.patientId];
    const patientName = n ? `${n.firstName} ${n.lastName}`.trim() || 'Unknown Patient' : 'Unknown Patient';
    return { ...r, patientName };
  });

  const refreshAll = () => { paged.refresh(); refreshCounts(); };


  const handleCancel = async (requestId: string, _reason?: string) => {
    try {
      await specialistRequestOperations.updateRequest(requestId, {
        status: 'cancelled',
      });
      setCancelConfirmId(null);
      refreshAll();
    } catch (error) {
      logger.error('Error cancelling specialist request:', error);
    }
  };

  if (loading && paged.rows.length === 0 && paged.page === 1) return <AdminGuard><LoadingSpinner /></AdminGuard>;

  return (
    <AdminGuard>
    <div className="space-y-6">
      <PageHeader
        backTo="/admin"
        icon={Stethoscope}
        iconColor="bg-primary-50 text-primary-700"
        title="Specialist Requests"
        subtitle="Manage patient specialist referral requests"
      />

      <StatsGrid items={[
        { icon: Stethoscope, iconColor: 'bg-primary-50 text-primary-700', label: 'Total', value: statusCounts.all },
        { icon: Clock, iconColor: 'bg-yellow-100 text-yellow-600', label: 'Pending', value: statusCounts.pending },
        { icon: CheckCircle, iconColor: 'bg-green-100 text-green-600', label: 'Confirmed', value: statusCounts.confirmed },
        { icon: XCircle, iconColor: 'bg-red-100 text-red-600', label: 'Cancelled', value: statusCounts.cancelled },
      ]} />

      <FilterTabs
        activeKey={filter}
        onChange={(k) => setFilter(k as 'all' | 'pending' | 'confirmed' | 'cancelled')}
        tabs={[
          { key: 'all', label: 'All', count: statusCounts.all },
          { key: 'pending', label: 'Pending', count: statusCounts.pending },
          { key: 'confirmed', label: 'Confirmed', count: statusCounts.confirmed },
          { key: 'cancelled', label: 'Cancelled', count: statusCounts.cancelled },
        ]}
      />

      <div className="flex justify-end">
        <Button onClick={refreshAll} loading={loading} variant="secondary" size="sm">
          <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
        </Button>
      </div>

      {/* Request List */}
      <div className={`transition-opacity duration-150 ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
        <Card className="p-6">
          <div className="space-y-4">
            {requestsPage.length === 0 ? (
              <div className="text-center py-12 text-secondary-500">
                <Stethoscope className="h-16 w-16 mx-auto mb-4 opacity-50" />
                <p>No specialist requests found</p>
              </div>
            ) : (
              requestsPage.map((request) => {
                const statusColor = request.status === 'pending'
                  ? 'bg-yellow-50 text-yellow-700'
                  : request.status === 'confirmed'
                    ? 'bg-green-50 text-green-700'
                    : 'bg-red-50 text-red-700';

                return (
                  <div
                    key={request.id}
                    className={`p-4 border rounded-lg ${
                      request.status === 'pending'
                        ? 'border-yellow-200 bg-yellow-50/30'
                        : 'border-secondary-200'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3 mb-2">
                          <User className="h-5 w-5 text-secondary-400" />
                          <h3 className="font-semibold text-secondary-900">{request.patientName}</h3>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                          <div>
                            <p className="text-sm text-secondary-600">Specialist</p>
                            <p className="font-medium text-secondary-900 flex items-center">
                              <Stethoscope className="h-4 w-4 mr-1 text-primary-600" />
                              {getSpecialistLabel(request.specialistType)}
                            </p>
                          </div>
                          <div>
                            <p className="text-sm text-secondary-600">Requested</p>
                            <p className="font-medium text-secondary-900">
                              {request.createdAt?.toDate
                                ? formatDate(request.createdAt.toDate())
                                : 'Unknown'}
                            </p>
                          </div>
                        </div>

                        {request.reason && (
                          <div className="mt-3">
                            <p className="text-sm text-secondary-600">Reason</p>
                            <p className="text-sm text-secondary-700">{request.reason}</p>
                          </div>
                        )}

                        {request.notes && (
                          <div className="mt-3">
                            <p className="text-sm text-secondary-600">Patient Notes</p>
                            <p className="text-sm text-secondary-700">{request.notes}</p>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col items-end space-y-2 ml-4">
                        <StatusBadge label={request.status} colorClass={statusColor} />

                        {request.status === 'pending' && (
                          <div className="flex flex-col space-y-1">
                            <Button
                              size="sm"
                              onClick={() => setConfirmingRequest(request)}
                              className="text-xs bg-green-600 hover:bg-green-700 text-white"
                            >
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Confirm
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setCancelConfirmId(request.id)}
                              className="text-xs text-red-600"
                            >
                              <XCircle className="h-3 w-3 mr-1" />
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <PaginationBar
            currentPage={paged.page}
            pageSize={paged.pageSize}
            totalItems={(paged.page - 1) * paged.pageSize + requestsPage.length + (paged.hasNext ? 1 : 0)}
            hasMore={paged.hasNext}
            onPreviousPage={paged.prev}
            onNextPage={paged.next}
            label="requests"
          />
        </Card>
      </div>


      <ConfirmSpecialistAppointmentModal
        request={confirmingRequest}
        onClose={() => setConfirmingRequest(null)}
        onConfirmed={refreshAll}
      />

      <ConfirmModal
        isOpen={!!cancelConfirmId}
        onClose={() => setCancelConfirmId(null)}
        onConfirm={(reason) => cancelConfirmId && handleCancel(cancelConfirmId, reason)}
        title="Cancel Specialist Request"
        message="Are you sure you want to cancel this specialist request?"
        confirmLabel="Cancel Request"
        variant="danger"
      />
    </div>
    </AdminGuard>
  );
};
