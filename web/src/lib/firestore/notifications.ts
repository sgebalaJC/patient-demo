import {
  doc,
  addDoc,
  getDocs,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  onSnapshot,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { isAdminRole } from '../roles';
import { collections } from './base';
import { Notification, NotificationType, ApiResponse, UserRole } from '../../types';
import logger from '../logger';

export const notificationOperations = {
  // Create a notification
  async createNotification(data: {
    recipientRole: Notification['recipientRole'];
    recipientId?: string;
    type: NotificationType;
    title: string;
    message: string;
    meta?: { [key: string]: string };
  }): Promise<ApiResponse<Notification>> {
    try {
      const newNotification = {
        ...data,
        meta: data.meta || {},
        isRead: false,
        readBy: {},
        createdAt: serverTimestamp(),
      };

      const docRef = await addDoc(collections.notifications, newNotification);
      return { success: true, data: { id: docRef.id, ...newNotification } as Notification };
    } catch (error: any) {
      logger.error('Error creating notification:', error);
      return { success: false, error: error.message };
    }
  },

  // Get unread notifications for admin users
  async getAdminNotifications(
    limitParam: number = 20
  ): Promise<ApiResponse<Notification[]>> {
    try {
      const q = query(
        collections.notifications,
        where('recipientRole', '==', 'admin'),
        orderBy('createdAt', 'desc'),
        limit(limitParam)
      );

      const snapshot = await getDocs(q);
      const notifications = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      } as Notification));

      return { success: true, data: notifications };
    } catch (error: any) {
      logger.error('Error getting admin notifications:', error);
      return { success: false, error: error.message };
    }
  },

  // Real-time listener for admin notifications
  onAdminNotifications(
    callback: (notifications: Notification[]) => void,
    limitParam: number = 30
  ): () => void {
    const q = query(
      collections.notifications,
      where('recipientRole', '==', 'admin'),
      orderBy('createdAt', 'desc'),
      limit(limitParam)
    );

    return onSnapshot(q, (snapshot) => {
      const notifications = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      } as Notification));
      callback(notifications);
    }, (error) => {
      logger.error('Error listening to notifications:', error);
    });
  },

  // Mark a single notification as read for a specific user
  async markAsRead(notificationId: string, userId: string): Promise<ApiResponse<void>> {
    try {
      const notificationRef = doc(collections.notifications, notificationId);
      await updateDoc(notificationRef, {
        [`readBy.${userId}`]: Timestamp.now(),
        isRead: true,
        readAt: serverTimestamp(),
      });
      return { success: true };
    } catch (error: any) {
      logger.error('Error marking notification as read:', error);
      return { success: false, error: error.message };
    }
  },

  // Real-time listener for a specific patient's notifications
  onPatientNotifications(
    patientId: string,
    callback: (notifications: Notification[]) => void,
    limitParam: number = 30
  ): () => void {
    const q = query(
      collections.notifications,
      where('recipientRole', '==', 'patient'),
      where('recipientId', '==', patientId),
      orderBy('createdAt', 'desc'),
      limit(limitParam)
    );

    return onSnapshot(q, (snapshot) => {
      const notifications = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      } as Notification));
      callback(notifications);
    }, (error) => {
      logger.error('Error listening to patient notifications:', error);
    });
  },

  // Mark all notifications as read for a specific user (role-aware)
  async markAllAsRead(userId: string, role: UserRole): Promise<ApiResponse<void>> {
    try {
      let q;
      if (isAdminRole(role)) {
        q = query(
          collections.notifications,
          where('recipientRole', '==', 'admin')
        );
      } else {
        q = query(
          collections.notifications,
          where('recipientRole', '==', 'patient'),
          where('recipientId', '==', userId)
        );
      }

      const snapshot = await getDocs(q);
      const batch = writeBatch(db);
      const now = Timestamp.now();

      snapshot.docs.forEach(docSnap => {
        const data = docSnap.data();
        if (!data.readBy?.[userId]) {
          batch.update(docSnap.ref, {
            [`readBy.${userId}`]: now,
            isRead: true,
            readAt: serverTimestamp(),
          });
        }
      });

      await batch.commit();
      return { success: true };
    } catch (error: any) {
      logger.error('Error marking all notifications as read:', error);
      return { success: false, error: error.message };
    }
  },
};
