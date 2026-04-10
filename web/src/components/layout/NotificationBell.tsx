import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Calendar, MessageSquare, UserPlus, Pill, AlertCircle, Check, CheckCheck, Stethoscope } from 'lucide-react';
import { Notification, NotificationType } from '../../types';
import { notificationOperations } from '../../lib/firestore';
import { getNotificationLink } from '../../lib/notification-links';
import { useAuth } from '../../hooks/useAuth';

const typeConfig: Record<NotificationType, { icon: React.ElementType; color: string; bgColor: string }> = {
  appointment_booked: { icon: Calendar, color: 'text-primary-600', bgColor: 'bg-primary-50' },
  appointment_cancelled: { icon: Calendar, color: 'text-red-600', bgColor: 'bg-red-50' },
  appointment_confirmed: { icon: Calendar, color: 'text-green-600', bgColor: 'bg-green-50' },
  new_message: { icon: MessageSquare, color: 'text-purple-600', bgColor: 'bg-purple-50' },
  new_patient: { icon: UserPlus, color: 'text-teal-600', bgColor: 'bg-teal-50' },
  refill_request: { icon: Pill, color: 'text-orange-600', bgColor: 'bg-orange-50' },
  specialist_request: { icon: Stethoscope, color: 'text-purple-600', bgColor: 'bg-purple-50' },
  system: { icon: AlertCircle, color: 'text-secondary-600', bgColor: 'bg-secondary-50' },
};

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

export const NotificationBell: React.FC = () => {
  const { user, userProfile } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const userId = user?.uid || '';
  const role = userProfile?.role;
  const unreadCount = notifications.filter(n => !n.readBy?.[userId]).length;

  // Real-time listener — role-aware (wait for profile to load)
  useEffect(() => {
    if (!userId || !role) return;

    const unsubscribe = role === 'admin'
      ? notificationOperations.onAdminNotifications((notifs) => setNotifications(notifs))
      : notificationOperations.onPatientNotifications(userId, (notifs) => setNotifications(notifs));

    return unsubscribe;
  }, [userId, role]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleNotificationClick = async (notification: Notification) => {
    // Mark as read
    if (!notification.readBy?.[userId]) {
      await notificationOperations.markAsRead(notification.id, userId);
    }

    // Navigate to deep link
    const link = getNotificationLink(notification.type, notification.meta || {}, role as 'admin' | 'patient');
    if (link) {
      setIsOpen(false);
      navigate(link);
    }
  };

  const handleMarkAllRead = async () => {
    await notificationOperations.markAllAsRead(userId, role as 'admin' | 'patient');
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative text-secondary-500 hover:text-secondary-700 p-2 rounded-lg hover:bg-secondary-50 transition-colors"
        title="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-red-500 rounded-full leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-96 bg-surface-card rounded-xl shadow-lg border border-secondary-200 z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-secondary-100 bg-secondary-50">
            <h3 className="text-sm font-semibold text-secondary-900">
              Notifications
              {unreadCount > 0 && (
                <span className="ml-2 text-xs font-medium text-secondary-500">
                  {unreadCount} unread
                </span>
              )}
            </h3>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="flex items-center text-xs text-primary-600 hover:text-primary-700 font-medium"
              >
                <CheckCheck className="h-3.5 w-3.5 mr-1" />
                Mark all read
              </button>
            )}
          </div>

          {/* Notification list */}
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 px-4">
                <Bell className="h-8 w-8 text-secondary-300 mb-2" />
                <p className="text-sm text-secondary-500">No notifications yet</p>
              </div>
            ) : (
              notifications.map((notification) => {
                const config = typeConfig[notification.type] || typeConfig.system;
                const Icon = config.icon;
                const isUnread = !notification.readBy?.[userId];
                const createdAt = notification.createdAt?.toDate?.()
                  ? notification.createdAt.toDate()
                  : new Date();

                return (
                  <button
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-secondary-50 transition-colors border-b border-secondary-50 last:border-0 ${
                      isUnread ? 'bg-primary-50/40' : ''
                    }`}
                  >
                    {/* Icon */}
                    <div className={`flex-shrink-0 p-2 rounded-lg ${config.bgColor}`}>
                      <Icon className={`h-4 w-4 ${config.color}`} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${isUnread ? 'font-semibold text-secondary-900' : 'text-secondary-700'}`}>
                        {notification.title}
                      </p>
                      <p className="text-xs text-secondary-500 mt-0.5 line-clamp-2">
                        {notification.message}
                      </p>
                      <p className="text-xs text-secondary-400 mt-1">
                        {timeAgo(createdAt)}
                      </p>
                    </div>

                    {/* Unread indicator */}
                    {isUnread ? (
                      <div className="flex-shrink-0 mt-1">
                        <div className="h-2.5 w-2.5 rounded-full bg-primary-500" />
                      </div>
                    ) : (
                      <div className="flex-shrink-0 mt-1">
                        <Check className="h-3.5 w-3.5 text-secondary-300" />
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
