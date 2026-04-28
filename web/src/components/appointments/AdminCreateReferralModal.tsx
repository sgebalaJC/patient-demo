/**
 * Admin "New Referral Appointment" modal — composes a confirmed specialist
 * referral on a patient's behalf in a single step. Used when the office
 * receives a confirmed appointment from the specialist directly (e.g.,
 * over the phone) and there's no patient-initiated request to round-trip
 * through pending → confirmed.
 *
 * Three Firestore writes fire on submit, in order:
 *   1. specialist-requests create with status: 'confirmed', confirmedBy
 *   2. appointments create with status: 'confirmed', isSpecialistReferral
 *   3. specialist-requests update linking the appointmentId
 * Plus a best-effort patient notification (`appointment_confirmed`).
 *
 * On step-2 failure the request from step 1 is rolled back to `cancelled`
 * to avoid an orphan confirmed referral with no appointment.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import {
  Stethoscope,
  CheckCircle,
  Calendar,
  Clock,
  MapPin,
  FileText,
  User as UserIcon,
  Search as SearchIcon,
  X as XIcon,
  Phone,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { SPECIALIST_TYPES, getSpecialistLabel } from '../../config/specialists';
import {
  specialistRequestOperations,
  appointmentOperations,
  notificationOperations,
  userOperations,
} from '../../lib/firestore';
import { FIELD_LIMITS } from '../../lib/validation';
import { useAuth } from '../../hooks/useAuth';
import { audit } from '../../lib/audit';
import { normalizePhoneNumber, InvalidPhoneError } from '../../lib/phone';
import { errorMessage } from '../../lib/errors';
import type { User } from '../../types';
import logger from '../../lib/logger';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface PatientLite {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phoneNumber?: string;
}

// Provider details + admin notes are folded into the appointment's `notes`
// field — the existing confirm flow does the same so admin views see them
// without schema changes.
function composeNotes(args: {
  providerName: string;
  providerPhone: string;
  extraNotes: string;
}): string {
  const lines: string[] = [];
  if (args.providerName) lines.push(`Provider: ${args.providerName}`);
  if (args.providerPhone) lines.push(`Phone: ${args.providerPhone}`);
  if (args.extraNotes) {
    if (lines.length) lines.push('');
    lines.push(args.extraNotes);
  }
  return lines.join('\n');
}

export const AdminCreateReferralModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
  const { user } = useAuth();

  // Patient picker state
  const [patientQuery, setPatientQuery] = useState('');
  const [patientResults, setPatientResults] = useState<PatientLite[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<PatientLite | null>(null);

  // Referral form state
  const [specialistType, setSpecialistType] = useState('');
  const [reason, setReason] = useState('');
  const [appointmentDate, setAppointmentDate] = useState('');
  const [appointmentTime, setAppointmentTime] = useState('');
  const [duration, setDuration] = useState(30);
  const [providerName, setProviderName] = useState('');
  const [providerPhone, setProviderPhone] = useState('');
  const [address, setAddress] = useState('');
  const [extraNotes, setExtraNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setPatientQuery('');
    setPatientResults([]);
    setSelectedPatient(null);
    setSpecialistType('');
    setReason('');
    setAppointmentDate('');
    setAppointmentTime('');
    setDuration(30);
    setProviderName('');
    setProviderPhone('');
    setAddress('');
    setExtraNotes('');
    setError('');
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  // Debounced patient search. Only fires when the modal is open + a patient
  // hasn't already been selected.
  useEffect(() => {
    if (!isOpen || selectedPatient) return;
    const q = patientQuery.trim();
    if (q.length < 2) {
      setPatientResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await userOperations.getAllUsers(20, 1, q);
        if (cancelled) return;
        if (res.success && res.data) {
          const patients = (res.data.users as User[])
            .filter((u) => u.role === 'patient')
            .map((u) => ({
              id: u.id,
              firstName: u.firstName,
              lastName: u.lastName,
              email: u.email,
              phoneNumber: u.phoneNumber,
            }));
          setPatientResults(patients);
        }
      } catch (err) {
        logger.error('referral patient search failed', err);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [patientQuery, isOpen, selectedPatient]);

  const reasonOk = reason.trim().length >= FIELD_LIMITS.specialistReason.min;
  const reasonTooShort = reason.trim().length > 0 && !reasonOk;

  const canSubmit = useMemo(() => {
    return (
      !!selectedPatient &&
      !!specialistType &&
      reasonOk &&
      !!appointmentDate &&
      !!appointmentTime &&
      !!user
    );
  }, [selectedPatient, specialistType, reasonOk, appointmentDate, appointmentTime, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !selectedPatient || !user) return;

    const dateTime = new Date(`${appointmentDate}T${appointmentTime}`);
    if (isNaN(dateTime.getTime())) {
      setError('Invalid date or time');
      return;
    }
    if (dateTime.getTime() < Date.now()) {
      setError('Appointment date must be in the future');
      return;
    }

    // Normalize provider phone — sister's normalizePhoneNumber throws on
    // invalid input (vs showmd's silent ''). Show the user a field error
    // instead of crashing the submit.
    let normalizedProviderPhone = '';
    if (providerPhone.trim()) {
      try {
        normalizedProviderPhone = normalizePhoneNumber(providerPhone);
      } catch (err) {
        if (err instanceof InvalidPhoneError) {
          setError('Provider phone is not a valid US number');
          return;
        }
        throw err;
      }
    }

    setSubmitting(true);
    setError('');

    const composedNotes = composeNotes({
      providerName: providerName.trim(),
      providerPhone: normalizedProviderPhone || providerPhone.trim(),
      extraNotes: extraNotes.trim(),
    });

    try {
      // 1. Create the specialist-request, already confirmed.
      const requestRes = await specialistRequestOperations.createRequest(
        selectedPatient.id,
        specialistType,
        reason.trim(),
        composedNotes || undefined,
        { status: 'confirmed', confirmedBy: user.uid },
      );
      if (!requestRes.success || !requestRes.data) {
        setError(requestRes.error || 'Failed to create referral');
        setSubmitting(false);
        return;
      }
      const requestId = requestRes.data.id;

      // 2. Create the companion appointment, also confirmed. Bypasses the
      // patient-facing availability slot machinery — the admin already has
      // a confirmed time from the specialist's office.
      const appointmentRes = await appointmentOperations.createAppointment({
        patientId: selectedPatient.id,
        appointmentDate: Timestamp.fromDate(dateTime),
        duration,
        status: 'confirmed',
        specialistType,
        isSpecialistReferral: true,
        specialistRequestId: requestId,
        reminderSent: false,
        ...(composedNotes ? { notes: composedNotes } : {}),
        ...(address.trim() ? { address: address.trim() } : {}),
      });

      if (!appointmentRes.success || !appointmentRes.data) {
        // Roll back the request — don't leave an orphan confirmed referral.
        specialistRequestOperations.updateRequest(requestId, {
          status: 'cancelled',
        }).catch(() => {});
        setError(appointmentRes.error || 'Failed to create appointment');
        setSubmitting(false);
        return;
      }

      const appointmentId = appointmentRes.data.id;

      // 3. Link the appointment back onto the request.
      specialistRequestOperations.updateRequest(requestId, {
        appointmentId,
      }).catch((err) => logger.debug('referral appointment link failed (non-blocking)', err));

      // 4. Notify the patient.
      const label = getSpecialistLabel(specialistType);
      const fmtDate = dateTime.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const fmtTime = dateTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      notificationOperations.createNotification({
        recipientRole: 'patient',
        recipientId: selectedPatient.id,
        type: 'appointment_confirmed',
        title: `${label} Referral Scheduled`,
        message: `Your ${label} appointment is scheduled for ${fmtDate} at ${fmtTime}${address.trim() ? ` at ${address.trim()}` : ''}.`,
        meta: { appointmentId },
      }).catch((err) => logger.debug('patient notification write failed (non-blocking)', err));

      audit({
        action: 'specialist_request.created_confirmed',
        resourceType: 'specialist-request',
        resourceId: requestId,
        metadata: {
          appointmentId,
          patientId: selectedPatient.id,
          specialistType,
          isSpecialistReferral: true,
        },
      });

      reset();
      onSuccess();
    } catch (err: unknown) {
      logger.error('Error creating admin referral:', err);
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="New Referral Appointment"
      icon={<div className="bg-purple-100 p-2 rounded-lg"><Stethoscope className="h-6 w-6 text-purple-600" /></div>}
      maxWidth="max-w-lg"
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-5">
        <ErrorAlert message={error} />

        {/* Patient picker */}
        <div>
          <label className="block text-sm font-medium text-secondary-700 mb-1">
            <UserIcon className="inline h-4 w-4 mr-1" />
            Patient *
          </label>
          {selectedPatient ? (
            <div className="flex items-center justify-between p-3 bg-purple-50 border border-purple-200 rounded-lg">
              <div className="text-sm">
                <p className="font-medium text-purple-900">
                  {selectedPatient.firstName} {selectedPatient.lastName}
                </p>
                <p className="text-purple-700">
                  {selectedPatient.email || selectedPatient.phoneNumber || ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedPatient(null);
                  setPatientQuery('');
                  setPatientResults([]);
                }}
                className="text-purple-500 hover:text-red-500"
                title="Change patient"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" />
              <input
                type="text"
                value={patientQuery}
                onChange={(e) => setPatientQuery(e.target.value)}
                placeholder="Search by name, email, or phone…"
                className="input w-full pl-9"
                autoFocus
              />
              {patientQuery.trim().length >= 2 && (
                <div className="mt-1 max-h-48 overflow-y-auto border border-secondary-200 rounded-md bg-surface-card divide-y divide-secondary-100">
                  {searching && patientResults.length === 0 && (
                    <p className="p-3 text-sm text-secondary-500">Searching…</p>
                  )}
                  {!searching && patientResults.length === 0 && (
                    <p className="p-3 text-sm text-secondary-500">No matching patients</p>
                  )}
                  {patientResults.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedPatient(p)}
                      className="w-full text-left p-3 hover:bg-secondary-50"
                    >
                      <p className="text-sm font-medium text-secondary-900">
                        {p.firstName} {p.lastName}
                      </p>
                      <p className="text-xs text-secondary-600">
                        {p.email || p.phoneNumber || '(no contact)'}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Specialty */}
        <div>
          <label className="block text-sm font-medium text-secondary-700 mb-1">
            <Stethoscope className="inline h-4 w-4 mr-1" />
            Specialist Type *
          </label>
          <select
            value={specialistType}
            onChange={(e) => setSpecialistType(e.target.value)}
            className="input w-full"
            required
          >
            <option value="">Select a specialist…</option>
            {SPECIALIST_TYPES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        {/* Reason */}
        <div>
          <label className="block text-sm font-medium text-secondary-700 mb-1">
            Reason for Referral *
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is the patient being referred?"
            rows={2}
            maxLength={FIELD_LIMITS.specialistReason.max}
            className="input w-full"
          />
          {reasonTooShort && (
            <p className="text-xs text-red-500 mt-1">
              At least {FIELD_LIMITS.specialistReason.min} characters required
            </p>
          )}
        </div>

        {/* Date + Time + Duration */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-secondary-700 mb-1">
              <Calendar className="inline h-4 w-4 mr-1" />
              Date *
            </label>
            <input
              type="date"
              value={appointmentDate}
              onChange={(e) => setAppointmentDate(e.target.value)}
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-secondary-700 mb-1">
              <Clock className="inline h-4 w-4 mr-1" />
              Time *
            </label>
            <input
              type="time"
              value={appointmentTime}
              onChange={(e) => setAppointmentTime(e.target.value)}
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-secondary-700 mb-1">
              Duration
            </label>
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="input w-full"
            >
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
              <option value={45}>45 min</option>
              <option value={60}>60 min</option>
              <option value={90}>90 min</option>
            </select>
          </div>
        </div>

        {/* Provider name + phone */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-secondary-700 mb-1">
              Provider Name
            </label>
            <input
              type="text"
              value={providerName}
              onChange={(e) => setProviderName(e.target.value)}
              placeholder="Dr. Smith"
              maxLength={120}
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-secondary-700 mb-1">
              <Phone className="inline h-4 w-4 mr-1" />
              Provider Phone
            </label>
            <input
              type="tel"
              value={providerPhone}
              onChange={(e) => setProviderPhone(e.target.value)}
              placeholder="(555) 123-4567"
              className="input w-full"
            />
          </div>
        </div>

        {/* Address */}
        <div>
          <label className="block text-sm font-medium text-secondary-700 mb-1">
            <MapPin className="inline h-4 w-4 mr-1" />
            Address
          </label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Street, City, State"
            maxLength={300}
            className="input w-full"
          />
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-secondary-700 mb-1">
            <FileText className="inline h-4 w-4 mr-1" />
            Additional Notes
          </label>
          <textarea
            value={extraNotes}
            onChange={(e) => setExtraNotes(e.target.value)}
            placeholder="Bring referral paperwork, insurance card, etc."
            rows={2}
            maxLength={FIELD_LIMITS.notes.max}
            className="input w-full"
          />
        </div>

        <div className="flex items-center justify-end space-x-3 pt-2 border-t border-secondary-200">
          <Button type="button" variant="secondary" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={submitting}
            disabled={!canSubmit}
            className="bg-green-600 hover:bg-green-700"
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            Create Referral
          </Button>
        </div>
      </form>
    </Modal>
  );
};
