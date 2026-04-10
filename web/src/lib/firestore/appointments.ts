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
import { collections } from './base';
import { Appointment, ApiResponse } from '../../types';
import logger from "../logger";

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
            return { success: true, data: { id: docRef.id, ...newAppointment } as Appointment };
        } catch (error: any) {
            logger.error('Error creating appointment:', error);
            return { success: false, error: error.message };
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
            const allAppointments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Appointment));

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
        } catch (error: any) {
            logger.error('Error getting appointments:', error);
            return { success: false, error: error.message };
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
            const allAppointments = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as Appointment));

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
        } catch (error: any) {
            logger.error('Error getting all appointments:', error);
            return { success: false, error: error.message };
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

            return { success: true, data: { id: appointmentId, ...updatedAppointment.data() } as Appointment };
        } catch (error: any) {
            logger.error('Error updating appointment:', error);
            return { success: false, error: error.message };
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
            const appointments = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as Appointment));

            return { success: true, data: appointments };
        } catch (error: any) {
            logger.error('Error getting all upcoming appointments:', error);
            return { success: false, error: error.message };
        }
    },
};