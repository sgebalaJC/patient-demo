import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useAuth } from '../hooks/useAuth';
import { useSimulationMode } from '../hooks/useSimulationMode';
import { isAdminRole } from '../lib/roles';
import {
  specialistRequestOperations,
  appointmentOperations,
  notificationOperations,
  prescriptionRefillOperations,
} from '../lib/firestore';
import { SpecialistRequest } from '../types';
import { Timestamp } from 'firebase/firestore';
import { Modal } from '../components/ui/Modal';
import {
  Stethoscope,
  Clock,
  User,
  CheckCircle,
  XCircle,
  MapPin,
  Calendar,
  FileText,
  RefreshCw,
} from 'lucide-react';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { AdminGuard } from '../components/ui/AdminGuard';
import { PageHeader } from '../components/ui/PageHeader';
import { StatsGrid } from '../components/ui/StatsGrid';
import { PaginationBar } from '../components/ui/PaginationBar';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { getSpecialistLabel } from '../config/specialists';
import { BUSINESS } from '../config/branding';
import { FIELD_LIMITS } from '../lib/validation';
import { formatDate } from '../lib/date-helpers';
import { usePagedCollection, type WhereClause } from '../hooks/usePagedCollection';
import { useCollectionCounts } from '../hooks/useCollectionCounts';
import logger from '../lib/logger';
import { Loader as MapsLoader } from '@googlemaps/js-api-loader';

type RequestWithPatient = SpecialistRequest & { patientName: string };

export const AdminSpecialistRequestsPage: React.FC = () => {
  const { user, userProfile } = useAuth();
  const { enabled: simulated } = useSimulationMode();
  const isAdminUser = !!user && isAdminRole(userProfile?.role);
  const [filter, setFilter] = useState<'all' | 'pending' | 'confirmed' | 'cancelled'>('pending');
  const [patientNames, setPatientNames] = useState<Record<string, { firstName: string; lastName: string }>>({});

  // Confirm modal
  const [confirmingRequest, setConfirmingRequest] = useState<RequestWithPatient | null>(null);
  const [confirmForm, setConfirmForm] = useState({
    appointmentDate: '',
    appointmentTime: '',
    duration: 30,
    notes: '',
    address: '',
  });
  const [confirming, setConfirming] = useState(false);
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);

  // Google Places autocomplete
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const autocompleteRef = useRef<google.maps.places.BasicPlaceAutocompleteElement | null>(null);
  const [useBusinessAddress, setUseBusinessAddress] = useState(false);

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

  // Initialize Google Places when confirm modal opens
  useEffect(() => {
    if (!confirmingRequest || !addressInputRef.current || useBusinessAddress) return;

    const loader = new MapsLoader({
      apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
      libraries: ['places'],
      version: 'weekly',
    });

    let mounted = true;

    const init = async () => {
      try {
        await loader.load();
        const { BasicPlaceAutocompleteElement } = await google.maps.importLibrary('places') as google.maps.PlacesLibrary;
        if (!mounted || !addressInputRef.current) return;

        const el = new BasicPlaceAutocompleteElement();
        el.includedPrimaryTypes = ['street_address', 'route', 'premise', 'establishment'];
        el.requestedLanguage = 'en';

        const originalInput = addressInputRef.current;
        const computed = window.getComputedStyle(originalInput);

        const style = document.createElement('style');
        style.textContent = `
          gmp-basic-place-autocomplete {
            width: 100% !important;
            color-scheme: light !important;
            height: ${computed.height} !important;
            padding: 0px !important;
            border: ${computed.border} !important;
            border-radius: ${computed.borderRadius} !important;
            font-size: ${computed.fontSize} !important;
            background-color: ${computed.backgroundColor} !important;
            box-sizing: ${computed.boxSizing} !important;
            outline: none !important;
          }
        `;
        document.head.appendChild(style);

        // Hide the React input instead of replacing it (replaceChild crashes React)
        originalInput.style.display = 'none';
        originalInput.parentNode?.insertBefore(el, originalInput.nextSibling);
        autocompleteRef.current = el;

        // Prevent suggestions from navigating (they render as <a> tags inside shadow DOM)
        el.addEventListener('click', (e: Event) => {
          const path = e.composedPath();
          if (path.some((node) => (node as HTMLElement).tagName === 'A')) {
            e.preventDefault();
          }
        }, true);

        el.addEventListener('gmp-select', async (event: any) => {
          const place = event.place;
          if (!place.id) return;
          try {
            const { Place } = await google.maps.importLibrary('places') as google.maps.PlacesLibrary;
            const p = new Place({ id: place.id, requestedLanguage: 'en' });
            await p.fetchFields({ fields: ['formattedAddress'] });
            if (p.formattedAddress) {
              setConfirmForm(f => ({ ...f, address: p.formattedAddress! }));
            }
          } catch (err) {
            logger.error('Error fetching place details:', err);
          }
        });
      } catch (err) {
        logger.error('Error initializing Google Places:', err);
      }
    };

    init();

    return () => {
      mounted = false;
      if (autocompleteRef.current) {
        autocompleteRef.current.remove();
        autocompleteRef.current = null;
      }
      // Restore the hidden React input
      if (addressInputRef.current) {
        addressInputRef.current.style.display = '';
      }
    };
  }, [confirmingRequest, useBusinessAddress]);

  const openConfirmModal = (request: RequestWithPatient) => {
    setConfirmingRequest(request);
    setConfirmForm({ appointmentDate: '', appointmentTime: '', duration: 30, notes: '', address: '' });
    setUseBusinessAddress(false);
  };

  const handleConfirm = async () => {
    if (!confirmingRequest || !confirmForm.appointmentDate || !confirmForm.appointmentTime || !user) return;
    setConfirming(true);
    try {
      const dateTime = new Date(`${confirmForm.appointmentDate}T${confirmForm.appointmentTime}`);

      // Create the appointment (confirmed, bypasses availability check)
      const appointmentRes = await appointmentOperations.createAppointment({
        patientId: confirmingRequest.patientId,
        appointmentDate: Timestamp.fromDate(dateTime),
        duration: confirmForm.duration,
        status: 'confirmed',
        specialistType: confirmingRequest.specialistType,
        isSpecialistReferral: true,
        specialistRequestId: confirmingRequest.id,
        reminderSent: false,
        ...(confirmForm.notes ? { notes: confirmForm.notes } : {}),
        ...(confirmForm.address ? { address: confirmForm.address } : {}),
      });

      if (appointmentRes.success && appointmentRes.data) {
        // Update the specialist request
        await specialistRequestOperations.updateRequest(confirmingRequest.id, {
          status: 'confirmed',
          appointmentId: appointmentRes.data.id,
          confirmedBy: user.uid,
          confirmedAt: Timestamp.now(),
        });

        // Notify the patient
        const label = getSpecialistLabel(confirmingRequest.specialistType);
        const fmtDate = dateTime.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const fmtTime = dateTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

        notificationOperations.createNotification({
          recipientRole: 'patient',
          recipientId: confirmingRequest.patientId,
          type: 'appointment_confirmed',
          title: `${label} Appointment Confirmed`,
          message: `Your ${label} appointment is scheduled for ${fmtDate} at ${fmtTime}${confirmForm.address ? ` at ${confirmForm.address}` : ''}.`,
          meta: { appointmentId: appointmentRes.data.id },
        }).catch(() => {});

        setConfirmingRequest(null);
        refreshAll();
      }
    } catch (error) {
      logger.error('Error confirming specialist request:', error);
    } finally {
      setConfirming(false);
    }
  };

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

      {/* Filters */}
      <Card className="p-6">
        <div className="space-y-4">
          <div className="flex space-x-2">
            {([
              { key: 'all', label: 'All', count: statusCounts.all },
              { key: 'pending', label: 'Pending', count: statusCounts.pending },
              { key: 'confirmed', label: 'Confirmed', count: statusCounts.confirmed },
              { key: 'cancelled', label: 'Cancelled', count: statusCounts.cancelled },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium border transition-colors ${
                  filter === tab.key
                    ? 'border-primary-600 text-primary-700 bg-primary-50'
                    : 'border-transparent bg-secondary-100 text-secondary-700 hover:bg-secondary-200'
                }`}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>
        </div>
      </Card>

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
                              onClick={() => openConfirmModal(request)}
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

      {/* Confirm Specialist Appointment Modal */}
      <Modal
        isOpen={!!confirmingRequest}
        onClose={() => setConfirmingRequest(null)}
        title="Confirm Specialist Appointment"
        icon={<div className="bg-green-100 p-2 rounded-lg"><Stethoscope className="h-6 w-6 text-green-600" /></div>}
        maxWidth="max-w-lg"
      >
        {confirmingRequest && (
          <div className="p-6 space-y-5">
            {/* Request info */}
            <div className="p-3 bg-primary-50 rounded-lg border border-primary-200">
              <p className="text-sm font-medium text-primary-700">
                {confirmingRequest.patientName} — {getSpecialistLabel(confirmingRequest.specialistType)}
              </p>
              {confirmingRequest.reason && (
                <p className="text-sm text-primary-700 mt-1"><span className="font-medium">Reason:</span> {confirmingRequest.reason}</p>
              )}
              {confirmingRequest.notes && (
                <p className="text-sm text-primary-700 mt-1">{confirmingRequest.notes}</p>
              )}
            </div>

            {/* Date */}
            <div>
              <label className="block text-sm font-medium text-secondary-700 mb-1">
                <Calendar className="inline h-4 w-4 mr-1" />
                Date *
              </label>
              <input
                type="date"
                value={confirmForm.appointmentDate}
                onChange={(e) => setConfirmForm(f => ({ ...f, appointmentDate: e.target.value }))}
                className="input w-full"
              />
            </div>

            {/* Time */}
            <div>
              <label className="block text-sm font-medium text-secondary-700 mb-1">
                <Clock className="inline h-4 w-4 mr-1" />
                Time *
              </label>
              <input
                type="time"
                value={confirmForm.appointmentTime}
                onChange={(e) => setConfirmForm(f => ({ ...f, appointmentTime: e.target.value }))}
                className="input w-full"
              />
            </div>

            {/* Duration */}
            <div>
              <label className="block text-sm font-medium text-secondary-700 mb-1">
                <Clock className="inline h-4 w-4 mr-1" />
                Duration
              </label>
              <select
                value={confirmForm.duration}
                onChange={(e) => setConfirmForm(f => ({ ...f, duration: Number(e.target.value) }))}
                className="input w-full"
              >
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={45}>45 minutes</option>
                <option value={60}>60 minutes</option>
                <option value={90}>90 minutes</option>
              </select>
            </div>

            {/* Address */}
            <div>
              <label className="block text-sm font-medium text-secondary-700 mb-1">
                <MapPin className="inline h-4 w-4 mr-1" />
                Address
              </label>
              <div className="flex items-center space-x-2 mb-2">
                <label className="flex items-center text-sm text-secondary-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useBusinessAddress}
                    onChange={(e) => {
                      setUseBusinessAddress(e.target.checked);
                      if (e.target.checked) {
                        setConfirmForm(f => ({ ...f, address: BUSINESS.address.full }));
                      } else {
                        setConfirmForm(f => ({ ...f, address: '' }));
                      }
                    }}
                    className="mr-2 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                  />
                  Use practice office address
                </label>
              </div>
              {useBusinessAddress ? (
                <p className="input w-full bg-secondary-50 text-secondary-700 flex items-center">
                  {BUSINESS.address.full}
                </p>
              ) : confirmForm.address ? (
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <MapPin className="h-4 w-4 text-green-600 flex-shrink-0" />
                  <span className="text-sm text-green-800 flex-1">{confirmForm.address}</span>
                  <button
                    type="button"
                    onClick={() => setConfirmForm(f => ({ ...f, address: '' }))}
                    className="text-green-500 hover:text-red-500 flex-shrink-0"
                    title="Clear address"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <input
                  ref={addressInputRef}
                  type="text"
                  value={confirmForm.address}
                  onChange={(e) => setConfirmForm(f => ({ ...f, address: e.target.value }))}
                  placeholder="Search for an address..."
                  className="input w-full"
                />
              )}
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-secondary-700 mb-1">
                <FileText className="inline h-4 w-4 mr-1" />
                Appointment Details
              </label>
              <textarea
                value={confirmForm.notes}
                onChange={(e) => setConfirmForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="e.g., Bring referral paperwork, insurance card..."
                rows={3}
                maxLength={FIELD_LIMITS.notes.max}
                className="input w-full"
              />
            </div>

            <div className="flex justify-end space-x-3 pt-2">
              <Button variant="secondary" onClick={() => setConfirmingRequest(null)}>Cancel</Button>
              <Button
                onClick={handleConfirm}
                loading={confirming}
                disabled={!confirmForm.appointmentDate || !confirmForm.appointmentTime}
                className="bg-green-600 hover:bg-green-700"
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Confirm Appointment
              </Button>
            </div>
          </div>
        )}
      </Modal>

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
