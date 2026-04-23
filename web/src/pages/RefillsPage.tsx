import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { RefillRequestForm } from '../components/refills/RefillRequestForm';
import { useAuth } from '../hooks/useAuth';
import { prescriptionRefillOperations } from '../lib/firestore';
import { PrescriptionRefillRequest } from '../types';
import {
    ArrowLeft,
    Plus,
    Pill,
    Edit,
    Trash2,
    Calendar
} from 'lucide-react';
import { SkeletonList } from '../components/ui/Skeleton';
import { ErrorAlert } from '../components/ui/ErrorAlert';
import { PaginationBar } from '../components/ui/PaginationBar';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { getUrgencyColor as getUrgencyColorHelper, getRefillStatusIcon, getRefillStatusColor } from '../lib/status-helpers';
import { formatDate } from '../lib/date-helpers';
import logger from '../lib/logger';

interface PaginationState {
    refills: PrescriptionRefillRequest[];
    total: number;
    currentPage: number;
    lastDocId?: string;
    hasMore: boolean;
    hasPrevious: boolean;
    pageSize: number;
    cursors: string[];
}

export const RefillsPage: React.FC = () => {
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [editingRefill, setEditingRefill] = useState<PrescriptionRefillRequest | undefined>();
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    const [paginationState, setPaginationState] = useState<PaginationState>({
        refills: [],
        total: 0,
        currentPage: 1,
        lastDocId: undefined,
        hasMore: false,
        hasPrevious: false,
        pageSize: 5,
        cursors: []
    });

    useEffect(() => {
        if (user) {
            loadFirstPage();
        }
    }, [user]);

    const loadFirstPage = async () => {
        if (!user) return;

        setLoading(true);
        setFetchError(null);
        try {
            const response = await prescriptionRefillOperations.getPatientRefills(
                user.uid,
                paginationState.pageSize
            );

            if (response.success && response.data) {
                const data = response.data;
                setPaginationState({
                    refills: data.refills,
                    total: data.total,
                    currentPage: 1,
                    lastDocId: data.lastDocId,
                    hasMore: data.hasMore,
                    hasPrevious: false,
                    pageSize: paginationState.pageSize,
                    cursors: data.lastDocId ? [data.lastDocId] : []
                });
            } else {
                setFetchError('We couldn’t load your refill requests. Please try again in a moment.');
            }
        } catch (error) {
            logger.error('Error fetching refills:', error);
            setFetchError('We couldn’t load your refill requests. Please try again in a moment.');
        } finally {
            setLoading(false);
        }
    };

    const loadNextPage = async () => {
        if (!user || !paginationState.hasMore) return;

        setLoading(true);
        try {
            const response = await prescriptionRefillOperations.getPatientRefills(
                user.uid,
                paginationState.pageSize,
                paginationState.lastDocId
            );

            if (response.success && response.data) {
                const data = response.data;
                setPaginationState(prev => ({
                    refills: data.refills,
                    total: data.total,
                    currentPage: prev.currentPage + 1,
                    lastDocId: data.lastDocId,
                    hasMore: data.hasMore,
                    hasPrevious: true,
                    pageSize: prev.pageSize,
                    cursors: data.lastDocId
                        ? [...prev.cursors, data.lastDocId]
                        : prev.cursors
                }));
            }
        } catch (error) {
            logger.error('Error fetching next page:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadPreviousPage = async () => {
        if (!user || !paginationState.hasPrevious) return;

        setLoading(true);
        try {
            const targetPage = paginationState.currentPage - 1;

            if (targetPage === 1) {
                await loadFirstPage();
                return;
            }

            const cursorForTargetPage = paginationState.cursors[targetPage - 2];

            const response = await prescriptionRefillOperations.getPatientRefills(
                user.uid,
                paginationState.pageSize,
                cursorForTargetPage
            );

            if (response.success && response.data) {
                const data = response.data;
                setPaginationState(prev => ({
                    refills: data.refills,
                    total: data.total,
                    currentPage: targetPage,
                    lastDocId: data.lastDocId,
                    hasMore: true,
                    hasPrevious: targetPage > 1,
                    pageSize: prev.pageSize,
                    cursors: prev.cursors.slice(0, targetPage - 1)
                }));
            }
        } catch (error) {
            logger.error('Error fetching previous page:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchRefills = async () => {
        await loadFirstPage();
    };

    const getUrgencyColor = getUrgencyColorHelper;

    const handleDelete = async (refillId: string) => {
        const response = await prescriptionRefillOperations.deleteRefillRequest(refillId);
        if (response.success) {
            fetchRefills();
        }
        setDeleteConfirmId(null);
    };

    if (loading) {
        return (
            <div className="space-y-6">
                <SkeletonList rows={4} leading="icon" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <Card className="p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
                    <div className="flex items-center space-x-3 sm:space-x-4">
                        <Link
                            to="/dashboard"
                            className="flex items-center text-primary-600 hover:text-primary-700 flex-shrink-0"
                        >
                            <ArrowLeft className="h-5 w-5" />
                        </Link>
                        <div className="flex items-center space-x-3 min-w-0">
                            <div className="bg-primary-100 p-2 sm:p-3 rounded-lg flex-shrink-0">
                                <Pill className="h-6 w-6 sm:h-8 sm:w-8 text-primary-600" />
                            </div>
                            <div className="min-w-0">
                                <h1 className="text-lg sm:text-xl font-bold text-secondary-900 truncate">Prescription Refills</h1>
                                <p className="text-secondary-600 text-sm sm:text-base">
                                    Request medicine prescriptions
                                    {paginationState.total > 0 && ` · ${paginationState.total} total`}
                                </p>
                            </div>
                        </div>
                    </div>

                    <Button
                        onClick={() => setShowForm(true)}
                        className="flex items-center justify-center w-full sm:w-auto"
                        size="md"
                    >
                        <Plus className="h-4 w-4 sm:h-5 sm:w-5 mr-2" />
                        <span className="sm:inline">New Request</span>
                    </Button>
                </div>
            </Card>

            {fetchError && <ErrorAlert message={fetchError} />}

            {paginationState.refills.length === 0 && !fetchError ? (
                <Card className="p-8 text-center">
                    <div className="flex flex-col items-center space-y-4">
                        <div className="bg-secondary-100 p-4 rounded-full">
                            <Pill className="h-8 w-8 text-secondary-400" />
                        </div>
                        <h3 className="text-lg font-semibold text-secondary-900">No refill requests yet</h3>
                        <p className="text-secondary-600">
                            When you request a prescription refill, it will appear here. Tap <strong>New Request</strong> above to start one.
                        </p>
                    </div>
                </Card>
            ) : (
                <>
                    {/* Refills List */}
                    <div className="grid gap-4 sm:gap-6">
                        {paginationState.refills.map((refill) => (
                            <Card key={refill.id} className="p-4 sm:p-6">
                                <div className="space-y-4">
                                    {/* Header with medication name, date, and actions */}
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex items-start space-x-3 min-w-0 flex-1">
                                            {React.createElement(getRefillStatusIcon(refill.status), { className: `h-5 w-5 ${refill.status === 'pending' ? 'text-yellow-500' : refill.status === 'approved' ? 'text-green-500' : refill.status === 'denied' ? 'text-red-500' : refill.status === 'completed' ? 'text-blue-500' : 'text-gray-500'}` })}
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-3 flex-wrap">
                          <span className="font-semibold text-base sm:text-lg text-secondary-900">
                            {refill.medicationName}
                          </span>
                                                    <div className="flex items-center text-sm text-secondary-600">
                                                        <Calendar className="h-4 w-4 mr-1" />
                                                        {refill.requestedDate ? formatDate(refill.requestedDate) : 'N/A'}
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap gap-2 mt-2">
                                                    <StatusBadge label={refill.urgency} colorClass={`capitalize ${getUrgencyColor(refill.urgency)}`} />
                                                    <StatusBadge label={refill.status} colorClass={`capitalize ${getRefillStatusColor(refill.status)}`} />
                                                </div>
                                            </div>
                                        </div>

                                        {refill.status === 'pending' && (
                                            <div className="flex space-x-1 flex-shrink-0">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => {
                                                        setEditingRefill(refill);
                                                        setShowForm(true);
                                                    }}
                                                    className="p-2"
                                                >
                                                    <Edit className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => setDeleteConfirmId(refill.id)}
                                                    className="text-red-600 hover:text-red-700 hover:bg-red-50 p-2"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Medication details */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                                        <div>
                                            <span className="font-medium text-secondary-700">Dosage:</span>
                                            <p className="text-secondary-900">{refill.dosage}</p>
                                        </div>
                                        <div>
                                            <span className="font-medium text-secondary-700">Quantity:</span>
                                            <p className="text-secondary-900">{refill.quantity}</p>
                                        </div>
                                        <div className="sm:col-span-2">
                                            <span className="font-medium text-secondary-700">Pharmacy:</span>
                                            <p className="text-secondary-900">
                                                {refill.pharmacyName}
                                                {refill.pharmacyAddress && (
                                                    <span className="text-secondary-600"> • {refill.pharmacyAddress}</span>
                                                )}
                                            </p>
                                        </div>
                                    </div>

                                    {refill.notes && (
                                        <div className="pt-2 border-t border-secondary-100">
                                            <span className="font-medium text-secondary-700">Notes:</span>
                                            <p className="text-secondary-900 mt-1 text-sm leading-relaxed">{refill.notes}</p>
                                        </div>
                                    )}

                                    {refill.doctorNotes && (
                                        <div className="pt-2 border-t border-secondary-100">
                                            <span className="font-medium text-secondary-700">Doctor Notes:</span>
                                            <p className="text-secondary-900 mt-1 text-sm leading-relaxed">{refill.doctorNotes}</p>
                                        </div>
                                    )}
                                </div>
                            </Card>
                        ))}
                    </div>

                    <PaginationBar
                      currentPage={paginationState.currentPage}
                      pageSize={paginationState.pageSize}
                      totalItems={paginationState.total}
                      hasMore={paginationState.hasMore}
                      onPreviousPage={loadPreviousPage}
                      onNextPage={loadNextPage}
                      label="refills"
                    />
                </>
            )}

            <ConfirmModal
                isOpen={!!deleteConfirmId}
                onClose={() => setDeleteConfirmId(null)}
                onConfirm={() => deleteConfirmId && handleDelete(deleteConfirmId)}
                title="Delete Refill Request"
                message="Are you sure you want to delete this refill request?"
                confirmLabel="Delete"
                variant="danger"
            />

            {/* Refill Request Form */}
            <RefillRequestForm
                isOpen={showForm}
                onClose={() => {
                    setShowForm(false);
                    setEditingRefill(undefined);
                }}
                onSuccess={fetchRefills}
                patientId={user?.uid || ''}
                editingRefill={editingRefill}
            />
        </div>
    );
};