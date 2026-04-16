import React, { useState, useEffect } from 'react';
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
    Calendar
} from 'lucide-react';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { AccessDenied } from '../components/ui/AccessDenied';
import { PageHeader } from '../components/ui/PageHeader';
import { FilterTabs } from '../components/ui/FilterTabs';
import { EmptyState } from '../components/ui/EmptyState';
import { PaginationBar } from '../components/ui/PaginationBar';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { getUrgencyColor as getUrgencyColorHelper, getRefillStatusColor, getRefillStatusIcon } from '../lib/status-helpers';
import { formatDate } from '../lib/date-helpers';
import logger from '../lib/logger';

const REFILL_STATUS_ICON_COLORS: Record<string, string> = {
    pending: 'text-yellow-500',
    approved: 'text-green-500',
    denied: 'text-red-500',
    completed: 'text-blue-500',
};

export const AdminRefillsPage: React.FC = () => {
    const { user, userProfile } = useAuth();
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'denied' | 'completed'>('all');
    const [patientNames, setPatientNames] = useState<{ [patientId: string]: { firstName: string; lastName: string } }>({});
    const [statusCounts, setStatusCounts] = useState({
        all: 0,
        pending: 0,
        approved: 0,
        denied: 0,
        completed: 0,
    });

    const [completeConfirmId, setCompleteConfirmId] = useState<string | null>(null);
    const [denyConfirmId, setDenyConfirmId] = useState<string | null>(null);
    const [allRefills, setAllRefills] = useState<PrescriptionRefillRequest[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const pageSize = 5;

    // Load all data once on mount
    useEffect(() => {
        if (user && isAdminRole(userProfile?.role)) {
            loadAllRefills();
        }
    }, [user, userProfile]);

    // Reset to page 1 when filter changes (no re-fetch)
    useEffect(() => { setCurrentPage(1); }, [filter]);

    const loadAllRefills = async () => {
        if (!user || !userProfile) return;

        setLoading(true);
        try {
            const response = await prescriptionRefillOperations.getAllRefills(1000, 1, 'all');

            if (response.success && response.data) {
                const all = Array.isArray(response.data) ? response.data : response.data.refills;
                setAllRefills(all);

                setStatusCounts({
                    all: all.length,
                    pending: all.filter(r => r.status === 'pending').length,
                    approved: all.filter(r => r.status === 'approved').length,
                    denied: all.filter(r => r.status === 'denied').length,
                    completed: all.filter(r => r.status === 'completed').length,
                });

                const uniquePatientIds = [...new Set(all.map(r => r.patientId))];
                if (uniquePatientIds.length > 0) {
                    const namesResponse = await prescriptionRefillOperations.getPatientNamesByIds(uniquePatientIds);
                    if (namesResponse.success && namesResponse.data) {
                        setPatientNames(namesResponse.data);
                    }
                }
            }
        } catch (error) {
            logger.error('Error fetching refills:', error);
        } finally {
            setLoading(false);
        }
    };

    // Client-side filter + paginate (instant, no network)
    const filtered = filter === 'all' ? allRefills : allRefills.filter(r => r.status === filter);
    const refillsPage = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    const hasMore = currentPage * pageSize < filtered.length;

    // Alias for action handlers that call fetchRefills()
    const fetchRefills = loadAllRefills;

    const handleApprove = async (refillId: string) => {
        try {
            const response = await prescriptionRefillOperations.updateRefillStatus(refillId, 'approved');
            if (response.success) {
                fetchRefills();
            }
        } catch (error) {
            logger.error('Error approving refill:', error);
        }
    };

    const handleDeny = async (refillId: string, reason?: string) => {
        try {
            const response = await prescriptionRefillOperations.updateRefillStatus(refillId, 'denied', reason || '');
            if (response.success) {
                fetchRefills();
            }
        } catch (error) {
            logger.error('Error denying refill:', error);
        }
        setDenyConfirmId(null);
    };

    const handleComplete = async (refillId: string) => {
        try {
            const response = await prescriptionRefillOperations.updateRefillStatus(refillId, 'completed');
            if (response.success) {
                fetchRefills();
            }
        } catch (error) {
            logger.error('Error completing refill:', error);
        }
        setCompleteConfirmId(null);
    };

    const getUrgencyColor = getUrgencyColorHelper;

    if (userProfile && !isAdminRole(userProfile.role)) {
        return <AccessDenied message="You don't have permission to manage prescription refills." />;
    }

    if (loading && allRefills.length === 0) {
        return <LoadingSpinner />;
    }

    const counts = statusCounts;

    return (
        <div className="space-y-6">
            <PageHeader
              backTo="/admin"
              icon={Pill}
              title="Prescription Refills"
              subtitle={`Total: ${filtered.length} refills`}
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
                      currentPage={currentPage}
                      pageSize={pageSize}
                      totalItems={filtered.length}
                      hasMore={hasMore}
                      onPreviousPage={() => setCurrentPage(currentPage - 1)}
                      onNextPage={() => setCurrentPage(currentPage + 1)}
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
    );
};
