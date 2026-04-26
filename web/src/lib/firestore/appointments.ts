import {
    doc,
    addDoc,
    getDoc,
    getDocs,
    updateDoc,
    query,
    where,
    orderBy,
    limit,
    serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { collections, mapDocStrict } from './base';
import { Appointment, ApiResponse } from '../../types';
import logger from "../logger";
import { errorMessage } from '../errors';
import { audit } from '../audit';

const APPOINTMENT_REQUIRED_KEYS: ReadonlyArray<keyof Appointment> = ['patientId', 'appointmentDate', 'status'];

function toAppointment(snap: Parameters<typeof mapDocStrict>[0]): Appointment | null {
  const mapped = mapDocStrict<Appointment>(snap, APPOINTMENT_REQUIRED_KEYS, 'appointments');
  return mapped;
}

// Appointment operations
export const appointmentOperations = {
    // Create appointment
    async createAppointment(appointmentData: Omit<Appointment, 'id' | 'createdAt' | 'updatedAt'>): Promise<ApiResponse<Appointment>> {
        try {
            const newAppointment = {
                ...appointmentData,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                reminderSent: false,
            };

            const docRef = await addDoc(collections.appointments, newAppointment);
            audit({
                action: 'appointment.created',
                resourceType: 'appointment',
                resourceId: docRef.id,
                metadata: {
                    patientId: appointmentData.patientId,
                    appointmentType: appointmentData.appointmentType,
                    isSpecialistReferral: !!appointmentData.isSpecialistReferral,
                },
            });
            return { success: true, data: { id: docRef.id, ...newAppointment } as Appointment };
        } catch (error: unknown) {
            logger.error('Error creating appointment:', error);
            return { success: false, error: errorMessage(error) };
        }
    },

    // Get appointments for user with pagination
    async getUserAppointments(
        userId: string,
        limitParam: number = 10,
        page: number = 1
    ): Promise<ApiResponse<{
        appointments: Appointment[],
        total: number,
        hasMore: boolean,
        currentPage: number
    }>> {
        try {

            // Get all appointments for this user
            const appointmentsQuery = query(
                collections.appointments,
                where('patientId', '==', userId),
                orderBy('appointmentDate', 'desc')
            );

            const snapshot = await getDocs(appointmentsQuery);
            const allAppointments = snapshot.docs
                .map(toAppointment)
                .filter((a): a is Appointment => a !== null);

            // Apply pagination
            const startIndex = (page - 1) * limitParam;
            const endIndex = startIndex + limitParam;
            const paginatedAppointments = allAppointments.slice(startIndex, endIndex);
            const hasMore = endIndex < allAppointments.length;

            return {
                success: true,
                data: {
                    appointments: paginatedAppointments,
                    total: allAppointments.length,
                    hasMore,
                    currentPage: page
                }
            };
        } catch (error: unknown) {
            logger.error('Error getting appointments:', error);
            return { success: false, error: errorMessage(error) };
        }
    },

    // Get all appointments (for admin) with pagination
    async getAllAppointments(
        limitParam: number = 10,
        page: number = 1
    ): Promise<ApiResponse<{
        appointments: Appointment[],
        total: number,
        hasMore: boolean,
        currentPage: number
    }>> {
        try {

            const appointmentsQuery = query(
                collections.appointments,
                orderBy('appointmentDate', 'desc')
            );

            const snapshot = await getDocs(appointmentsQuery);
            const allAppointments = snapshot.docs
                .map(toAppointment)
                .filter((a): a is Appointment => a !== null);

            // Apply pagination
            const startIndex = (page - 1) * limitParam;
            const endIndex = startIndex + limitParam;
            const paginatedAppointments = allAppointments.slice(startIndex, endIndex);
            const hasMore = endIndex < allAppointments.length;

            return {
                success: true,
                data: {
                    appointments: paginatedAppointments,
                    total: allAppointments.length,
                    hasMore,
                    currentPage: page
                }
            };
        } catch (error: unknown) {
            logger.error('Error getting all appointments:', error);
            return { success: false, error: errorMessage(error) };
        }
    },

    // Update appointment
    async updateAppointment(appointmentId: string, updates: Partial<Appointment>): Promise<ApiResponse<Appointment>> {
        try {
            const appointmentRef = doc(collections.appointments, appointmentId);
            const updateData = {
                ...updates,
                updatedAt: serverTimestamp(),
            };

            await updateDoc(appointmentRef, updateData);
            const updatedAppointment = await getDoc(appointmentRef);
            const mapped = toAppointment(updatedAppointment);
            if (!mapped) {
                return { success: false, error: 'Appointment updated but could not be re-read' };
            }
            // Discrete events for status transitions that affect patient
            // care — easier to query in the audit log than scanning every
            // `appointment.updated`. The generic update event is still
            // emitted for catch-all coverage.
            if (updates.status === 'confirmed') {
                audit({
                    action: 'appointment.confirmed',
                    resourceType: 'appointment',
                    resourceId: appointmentId,
                    metadata: { previousStatus: mapped.status, patientId: mapped.patientId },
                });
            } else if (updates.status === 'cancelled') {
                audit({
                    action: 'appointment.cancelled',
                    resourceType: 'appointment',
                    resourceId: appointmentId,
                    metadata: { patientId: mapped.patientId },
                });
            }
            audit({
                action: 'appointment.updated',
                resourceType: 'appointment',
                resourceId: appointmentId,
                metadata: { changedFields: Object.keys(updates) },
            });
            return { success: true, data: { ...mapped, id: appointmentId } };
        } catch (error: unknown) {
            logger.error('Error updating appointment:', error);
            return { success: false, error: errorMessage(error) };
        }
    },

    // Get all upcoming appointments (for admins)
    async getAllUpcomingAppointments(): Promise<ApiResponse<Appointment[]>> {
        try {
            const now = new Date();
            const appointmentsQuery = query(
                collections.appointments,
                where('appointmentDate', '>=', Timestamp.fromDate(now)),
                orderBy('appointmentDate', 'asc'),
                limit(10)
            );

            const snapshot = await getDocs(appointmentsQuery);
            const appointments = snapshot.docs
                .map(toAppointment)
                .filter((a): a is Appointment => a !== null);

            return { success: true, data: appointments };
        } catch (error: unknown) {
            logger.error('Error getting all upcoming appointments:', error);
            return { success: false, error: errorMessage(error) };
        }
    },
};