/**
 * Admin "Confirm Specialist Appointment" modal — pulled out of
 * AdminSpecialistRequestsPage so the page is just the list / filters /
 * cancel-confirm. Owns its own form state, the Google Places autocomplete
 * effect, and the three Firestore writes (create appointment + update
 * specialist request + notify patient) that fire on confirm.
 *
 * Parent contract is three props: the request to confirm (null = closed),
 * an `onClose` callback, and an `onConfirmed` callback so the parent can
 * refetch its list.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import { Calendar, CheckCircle, Clock, FileText, MapPin, Stethoscope, XCircle } from 'lucide-react';
import { Loader as MapsLoader } from '@googlemaps/js-api-loader';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useAuth } from '../../hooks/useAuth';
import { appointmentOperations, notificationOperations, specialistRequestOperations } from '../../lib/firestore';
import { getSpecialistLabel } from '../../config/specialists';
import { BUSINESS } from '../../config/branding';
import { FIELD_LIMITS } from '../../lib/validation';
import logger from '../../lib/logger';
import type { SpecialistRequest } from '../../types';

export type RequestWithPatient = SpecialistRequest & { patientName: string };

interface ConfirmSpecialistAppointmentModalProps {
  request: RequestWithPatient | null;
  onClose: () => void;
  onConfirmed: () => void;
}

export const ConfirmSpecialistAppointmentModal: React.FC<ConfirmSpecialistAppointmentModalProps> = ({
  request,
  onClose,
  onConfirmed,
}) => {
  const { user } = useAuth();
  const [confirmForm, setConfirmForm] = useState({
    appointmentDate: '',
    appointmentTime: '',
    duration: 30,
    notes: '',
    address: '',
  });
  const [confirming, setConfirming] = useState(false);
  const [useBusinessAddress, setUseBusinessAddress] = useState(false);
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const autocompleteRef = useRef<google.maps.places.BasicPlaceAutocompleteElement | null>(null);

  // Reset form whenever a new request is opened.
  useEffect(() => {
    if (!request) return;
    setConfirmForm({ appointmentDate: '', appointmentTime: '', duration: 30, notes: '', address: '' });
    setUseBusinessAddress(false);
  }, [request]);

  // Google Places autocomplete — mounts a `gmp-basic-place-autocomplete`
  // web component over the React-controlled input. Re-runs when the modal
  // opens (request changes) or the user toggles the practice-address shortcut.
  useEffect(() => {
    if (!request || !addressInputRef.current || useBusinessAddress) return;

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

        el.addEventListener('gmp-select', async (event) => {
          const place = event.place;
          if (!place.id) return;
          try {
            const { Place } = await google.maps.importLibrary('places') as google.maps.PlacesLibrary;
            const p = new Place({ id: place.id, requestedLanguage: 'en' });
            await p.fetchFields({ fields: ['formattedAddress'] });
            if (p.formattedAddress) {
              setConfirmForm((f) => ({ ...f, address: p.formattedAddress! }));
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
  }, [request, useBusinessAddress]);

  const handleConfirm = async () => {
    if (!request || !confirmForm.appointmentDate || !confirmForm.appointmentTime || !user) return;
    setConfirming(true);
    try {
      const dateTime = new Date(`${confirmForm.appointmentDate}T${confirmForm.appointmentTime}`);

      // Create the appointment (confirmed, bypasses availability check)
      const appointmentRes = await appointmentOperations.createAppointment({
        patientId: request.patientId,
        appointmentDate: Timestamp.fromDate(dateTime),
        duration: confirmForm.duration,
        status: 'confirmed',
        specialistType: request.specialistType,
        isSpecialistReferral: true,
        specialistRequestId: request.id,
        reminderSent: false,
        ...(confirmForm.notes ? { notes: confirmForm.notes } : {}),
        ...(confirmForm.address ? { address: confirmForm.address } : {}),
      });

      if (appointmentRes.success && appointmentRes.data) {
        // Update the specialist request
        await specialistRequestOperations.updateRequest(request.id, {
          status: 'confirmed',
          appointmentId: appointmentRes.data.id,
          confirmedBy: user.uid,
          confirmedAt: Timestamp.now(),
        });

        // Notify the patient
        const label = getSpecialistLabel(request.specialistType);
        const fmtDate = dateTime.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const fmtTime = dateTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

        notificationOperations.createNotification({
          recipientRole: 'patient',
          recipientId: request.patientId,
          type: 'appointment_confirmed',
          title: `${label} Appointment Confirmed`,
          message: `Your ${label} appointment is scheduled for ${fmtDate} at ${fmtTime}${confirmForm.address ? ` at ${confirmForm.address}` : ''}.`,
          meta: { appointmentId: appointmentRes.data.id },
        }).catch((err) => logger.warn('Failed to notify patient of confirmation:', err));

        onConfirmed();
        onClose();
      }
    } catch (error) {
      logger.error('Error confirming specialist request:', error);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Modal
      isOpen={!!request}
      onClose={onClose}
      title="Confirm Specialist Appointment"
      icon={<div className="bg-green-100 p-2 rounded-lg"><Stethoscope className="h-6 w-6 text-green-600" /></div>}
      maxWidth="max-w-lg"
    >
      {request && (
        <div className="p-6 space-y-5">
          {/* Request info */}
          <div className="p-3 bg-primary-50 rounded-lg border border-primary-200">
            <p className="text-sm font-medium text-primary-700">
              {request.patientName} — {getSpecialistLabel(request.specialistType)}
            </p>
            {request.reason && (
              <p className="text-sm text-primary-700 mt-1"><span className="font-medium">Reason:</span> {request.reason}</p>
            )}
            {request.notes && (
              <p className="text-sm text-primary-700 mt-1">{request.notes}</p>
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
                maxLength={FIELD_LIMITS.address.max}
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
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
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
  );
};
