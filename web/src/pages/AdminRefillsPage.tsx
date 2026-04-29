import React, { useEffect, useMemo, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { useAuth } from '../hooks/useAuth';
import { isAdminRole } from '../lib/roles';
import { prescriptionRefillOperations } from '../lib/firestore';
import { PrescriptionRefillRequest } from '../types';
import {
    Pill,
    User,
    Phone,
    Check,
    X,
    CheckCircle2,
    Calendar,
    RefreshCw,
} from 'lucide-react';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { AdminGuard } from '../components/ui/AdminGuard';
import { PageHeader } from '../components/ui/PageHeader';
import { FilterTabs } from '../components/ui/FilterTabs';
import { EmptyState } from '../components/ui/EmptyState';
import { PaginationBar } from '../components/ui/PaginationBar';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { getUrgencyColor as getUrgencyColorHelper, getRefillStatusColor, getRefillStatusIcon } from '../lib/status-helpers';
import { formatDate } from '../lib/date-helpers';
import { usePagedCollection, type WhereClause } from '../hooks/usePagedCollection';
import { useCollectionCounts } from '../hooks/useCollectionCounts';
import logger from '../lib/logger';

const REFILL_STATUS_ICON_COLORS: Record<string, string> = {
    pending: 'text-yellow-500',
    approved: 'text-green-500',
    denied: 'text-red-500',
    completed: 'text-blue-500',
};

export const AdminRefillsPage: React.FC = () => {
    const { user, userProfile } = useAuth();
    const isAdminUser = !!user && isAdminRole(userProfile?.role);
    const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'denied' | 'completed'>('all');
    const [patientNames, setPatientNames] = useState<{ [patientId: string]: { firstName: string; lastName: string } }>({});

    const [completeConfirmId, setCompleteConfirmId] = useState<string | null>(null);
    const [denyConfirmId, setDenyConfirmId] = useState<string | null>(null);

    const whereClauses = useMemo<WhereClause[] | undefined>(
        () => (filter === 'all' ? undefined : [['status', '==', filter]]),
        [filter],
    );

    const paged = usePagedCollection<PrescriptionRefillRequest & { id: string }>({
        enabled: isAdminUser,
        real: 'prescription-refills',
        orderField: 'createdAt',
        pageSize: 5,
        whereClauses,
        mapDoc: (d) => ({ ...(d.data() as PrescriptionRefillRequest), id: d.id }),
    });
    const refillsPage = paged.rows;
    const loading = paged.loading;

    const countsPredicates = useMemo(() => ({
        all: [] as [string, '==', string][],
        pending: [['status', '==', 'pending']] as [string, '==', string][],
        approved: [['status', '==', 'approved']] as [string, '==', string][],
        denied: [['status', '==', 'denied']] as [string, '==', string][],
        completed: [['status', '==', 'completed']] as [string, '==', string][],
    }), []);
    const { counts: statusCounts, refresh: refreshCounts } = useCollectionCounts({
        enabled: isAdminUser,
        real: 'prescription-refills',
        predicates: countsPredicates,
    });

    // Fetch patient names for just the current page's refills.
    useEffect(() => {
        const ids = [...new Set(refillsPage.map((r) => r.patientId))].filter(
            (id) => !(id in patientNames),
        );
        if (ids.length === 0) return;
        prescriptionRefillOperations.getPatientNamesByIds(ids).then((res) => {
            if (res.success && res.data) {
                setPatientNames((prev) => ({ ...prev, ...res.data }));
            }
        }).catch((err) => logger.error('patient-name lookup failed', err));
    }, [refillsPage, patientNames]);

    const refreshAll = () => { paged.refresh(); refreshCounts(); };

    const handleApprove = async (refillId: string) => {
        try {
            const response = await prescriptionRefillOperations.updateRefillStatus(refillId, 'approved');
            if (response.success) refreshAll();
        } catch (error) {
            logger.error('Error approving refill:', error);
        }
    };

    const handleDeny = async (refillId: string, reason?: string) => {
        try {
            const response = await prescriptionRefillOperations.updateRefillStatus(refillId, 'denied', reason || '');
            if (response.success) refreshAll();
        } catch (error) {
            logger.error('Error denying refill:', error);
        }
        setDenyConfirmId(null);
    };

    const handleComplete = async (refillId: string) => {
        try {
            const response = await prescriptionRefillOperations.updateRefillStatus(refillId, 'completed');
            if (response.success) refreshAll();
        } catch (error) {
            logger.error('Error completing refill:', error);
        }
        setCompleteConfirmId(null);
    };

    const getUrgencyColor = getUrgencyColorHelper;

    const counts = statusCounts;

    if (loading && refillsPage.length === 0 && paged.page === 1) {
        return <AdminGuard><LoadingSpinner /></AdminGuard>;
    }

    return (
        <AdminGuard>
        <div className="space-y-6">
            <PageHeader
              backTo="/admin"
              icon={Pill}
              title="Prescription Refills"
              subtitle={`Total: ${counts.all} refills`}
            />

            <FilterTabs
              tabs={[
                { key: 'all', label: 'All', count: counts.all },
                { key: 'pending', label: 'Pending', count: counts.pending },
                { key: 'approved', label: 'Approved', count: counts.approved },
                { key: 'denied', label: 'Denied', count: counts.denied },
                { key: 'completed', label: 'Completed', count: counts.completed },
              ]}
              activeKey={filter}
              onChange={(key) => setFilter(key as typeof filter)}
            />

            <div className="flex justify-end">
              <Button onClick={refreshAll} loading={loading} variant="secondary" size="sm">
                <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
              </Button>
            </div>

            <div className={`transition-opacity duration-150 ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
            {refillsPage.length === 0 && !loading ? (
                <EmptyState
                  icon={Pill}
                  title={`No ${filter !== 'all' ? filter : ''} refill requests`}
                  description={filter === 'all'
                    ? "No patients have submitted refill requests yet."
                    : `No ${filter} refill requests found.`
                  }
                />
            ) : (
                <>
                    <div className="grid gap-6">
                        {refillsPage.map((refill) => {
                            const StatusIcon = getRefillStatusIcon(refill.status);
                            const iconColor = REFILL_STATUS_ICON_COLORS[refill.status] || 'text-gray-500';
                            return (
                            <Card key={refill.id} className="p-6">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1 min-w-0">
                                        {/* Header with medication name and date */}
                                        <div className="flex items-start justify-between mb-4">
                                            <div className="flex items-center space-x-3 flex-1 min-w-0">
                                                <StatusIcon className={`h-5 w-5 ${iconColor}`} />
                                                <span className="font-semibold text-lg text-secondary-900">
                          {refill.medicationName}
                        </span>
                                                <StatusBadge label={refill.urgency} colorClass={getUrgencyColor(refill.urgency)} />
                                                <StatusBadge label={refill.status} colorClass={`capitalize ${getRefillStatusColor(refill.status)}`} />
                                            </div>
                                            <div className="flex items-center text-sm text-secondary-600 flex-shrink-0 ml-4">
                                                <Calendar className="h-4 w-4 mr-1" />
                                                {formatDate(refill.requestedDate)}
                                            </div>
                                        </div>

                                        {/* Patient Info */}
                                        <div className="bg-secondary-50 p-4 rounded-lg mb-4">
                                            <div className="flex items-center space-x-2 mb-2">
                                                <User className="h-4 w-4 text-secondary-600" />
                                                <span className="font-medium text-secondary-900">
                          Patient: {patientNames[refill.patientId]
                                                    ? `${patientNames[refill.patientId].firstName} ${patientNames[refill.patientId].lastName}`
                                                    : `Patient ID: ${refill.patientId}`}
                        </span>
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-secondary-600">
                                                <div className="flex items-center space-x-1">
                                                    <Phone className="h-3 w-3" />
                                                    <span>
                            Pharmacy: {refill.pharmacyName}
                                                        {refill.pharmacyAddress && (
                                                            <span className="text-secondary-500"> • {refill.pharmacyAddress}</span>
                                                        )}
                          </span>
                                                </div>
                                                <div className="flex items-center space-x-1">
                                                    <Phone className="h-3 w-3" />
                                                    <span>Phone: {refill.pharmacyPhone || 'N/A'}</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Medication Details */}
                                        <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                                            <div>
                                                <span className="font-medium text-secondary-700">Dosage:</span>
                                                <p className="text-secondary-900">{refill.dosage}</p>
                                            </div>
                                            <div>
                                                <span className="font-medium text-secondary-700">Quantity:</span>
                                                <p className="text-secondary-900">{refill.quantity}</p>
                                            </div>
                                        </div>

                                        {refill.notes && (
                                            <div className="mb-4">
                                                <span className="font-medium text-secondary-700">Patient Notes:</span>
                                                <p className="text-secondary-900 mt-1 p-3 bg-blue-50 rounded-lg">{refill.notes}</p>
                                            </div>
                                        )}

                                        {refill.doctorNotes && (
                                            <div className="mb-4">
                                                <span className="font-medium text-secondary-700">Doctor Notes:</span>
                                                <p className="text-secondary-900 mt-1 p-3 bg-green-50 rounded-lg">{refill.doctorNotes}</p>
                                            </div>
                                        )}
                                    </div>

                                    {/* Action Buttons */}
                                    {refill.status === 'pending' && (
                                        <div className="flex flex-col space-y-2 flex-shrink-0">
                                            <Button
                                                size="sm"
                                                onClick={() => handleApprove(refill.id)}
                                                className="border border-primary-400 text-primary-600 bg-transparent hover:bg-primary-50"
                                            >
                                                <Check className="h-4 w-4 mr-1" />
                                                Approve
                                            </Button>
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => setDenyConfirmId(refill.id)}
                                                className="border-red-300 text-red-700 hover:bg-red-50"
                                            >
                                                <X className="h-4 w-4 mr-1" />
                                                Deny
                                            </Button>
                                        </div>
                                    )}

                                    {refill.status === 'approved' && (
                                        <div className="flex flex-col space-y-2 flex-shrink-0">
                                            <Button
                                                size="sm"
                                                onClick={() => setCompleteConfirmId(refill.id)}
                                                className="bg-blue-600 hover:bg-blue-700 text-white"
                                            >
                                                <CheckCircle2 className="h-4 w-4 mr-1" />
                                                Mark Completed
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </Card>
                            );
                        })}
                    </div>

                    <PaginationBar
                      currentPage={paged.page}
                      pageSize={paged.pageSize}
                      totalItems={(paged.page - 1) * paged.pageSize + refillsPage.length + (paged.hasNext ? 1 : 0)}
                      hasMore={paged.hasNext}
                      onPreviousPage={paged.prev}
                      onNextPage={paged.next}
                      label="refills"
                    />
                </>
            )}
            </div>

            <ConfirmModal
                isOpen={!!completeConfirmId}
                onClose={() => setCompleteConfirmId(null)}
                onConfirm={() => completeConfirmId && handleComplete(completeConfirmId)}
                title="Complete Refill"
                message="Mark this refill as completed? This indicates the patient has received their medication."
                confirmLabel="Mark Completed"
                variant="info"
            />

            <ConfirmModal
                isOpen={!!denyConfirmId}
                onClose={() => setDenyConfirmId(null)}
                onConfirm={(reason) => denyConfirmId && handleDeny(denyConfirmId, reason)}
                title="Deny Refill"
                message="Are you sure you want to deny this refill request?"
                confirmLabel="Deny"
                variant="danger"
                inputPrompt="Reason for denial"
                inputPlaceholder="Please provide a reason..."
            />
        </div>
        </AdminGuard>
    );
};
