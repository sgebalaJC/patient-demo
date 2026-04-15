import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { StatusBadge } from '../ui/StatusBadge';
import { Appointment } from '../../types';
import { appointmentOperations, notificationOperations } from '../../lib/firestore';
import { useAuth } from '../../hooks/useAuth';
import {
  Calendar,
  Clock,
  Edit3,
  Trash2,
  AlertCircle,
  Stethoscope,
  MapPin,
} from 'lucide-react';
import { PaginationBar } from '../ui/PaginationBar';
import { ConfirmModal } from '../ui/ConfirmModal';
import { LoadingState } from '../ui/LoadingState';
import { Timestamp } from 'firebase/firestore';
import { getAppointmentStatusColor } from '../../lib/status-helpers';
import { formatDate, formatTime } from '../../lib/date-helpers';
import { getSpecialistLabel } from '../../config/specialists';
import logger from "../../lib/logger";

interface AppointmentListProps {
  onEditAppointment: (appointment: Appointment) => void;
  refreshTrigger?: number;
}

export const AppointmentList: React.FC<AppointmentListProps> = ({
  onEditAppointment,
  refreshTrigger,
}) => {
  const { user } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string>('');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(5);
  const [totalItems, setTotalItems] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    if (user) {
      setCurrentPage(1);
      fetchAppointments(1);
    }
  }, [user, refreshTrigger]);

  const fetchAppointments = async (page: number = currentPage) => {
    if (!user) return;

    try {
      setLoading(true);
      setError('');

      logger.log('📅 [AppointmentList] Fetching appointments with pagination', {
        user: user.uid,
        page,
        pageSize
      });

      const response = await appointmentOperations.getUserAppointments(user.uid, pageSize, page);

      if (response.success && response.data) {
        setAppointments(response.data.appointments);
        setTotalItems(response.data.total);
        setHasMore(response.data.hasMore);

        logger.log('✅ [AppointmentList] Appointments retrieved', {
          total: response.data.total,
          returned: response.data.appointments.length,
          hasMore: response.data.hasMore
        });
      } else {
        setError(response.error || 'Failed to fetch appointments');
      }
    } catch (error: any) {
      setError('Error loading appointments');
      logger.error('Error fetching appointments:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAppointment = async (appointmentId: string) => {
    setCancelConfirmId(null);
    try {
      setDeletingId(appointmentId);
      const response = await appointmentOperations.updateAppointment(appointmentId, {
        status: 'cancelled'
      });

      if (response.success) {
        // Notify admin
        if (user) {
          const apt = appointments.find(a => a.id === appointmentId);
          const dateStr = apt ? formatDate(apt.appointmentDate) : '';
          notificationOperations.createNotification({
            recipientRole: 'admin',
            type: 'appointment_cancelled',
            title: 'Appointment Cancelled',
            message: `Patient cancelled their appointment${dateStr ? ` on ${dateStr}` : ''}`,
            meta: { patientId: user.uid, appointmentId },
          }).catch(() => {});
        }
        // Refresh the appointments list
        fetchAppointments();
      } else {
        setError('Failed to cancel appointment: ' + (response.error || 'Unknown error'));
      }
    } catch (error: any) {
      setError('Error cancelling appointment: ' + error.message);
    } finally {
      setDeletingId(null);
    }
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    fetchAppointments(newPage);
  };



  const isUpcoming = (appointmentDate: Timestamp | Date | string) => {
    const date = appointmentDate instanceof Timestamp
      ? appointmentDate.toDate()
      : new Date(appointmentDate);
    return date > new Date();
  };

  if (loading) {
    return <LoadingState title="Loading appointments…" />;
  }

  if (error) {
    return (
      <Card className="p-6">
        <div className="flex items-center space-x-3 mb-4">
          <AlertCircle className="h-6 w-6 text-red-500" />
          <h3 className="text-lg font-semibold text-red-900">Error Loading Appointments</h3>
        </div>
        <p className="text-red-600 mb-4">{error}</p>
        <Button onClick={() => fetchAppointments()} variant="secondary" size="sm">
          Try Again
        </Button>
      </Card>
    );
  }

  if (appointments.length === 0) {
    return (
      <Card className="p-8 text-center">
        <div className="flex flex-col items-center space-y-4">
          <div className="bg-secondary-100 p-4 rounded-full">
            <Calendar className="h-8 w-8 text-secondary-400" />
          </div>
          <h3 className="text-lg font-semibold text-secondary-900">No Appointments Yet</h3>
          <p className="text-secondary-600">
            You haven't scheduled any appointments. Click "Schedule Appointment" to get started.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {appointments.map((appointment) => {
        const date = formatDate(appointment.appointmentDate);
        const time = formatTime(appointment.appointmentDate);
        const upcoming = isUpcoming(appointment.appointmentDate);
        return (
          <Card key={appointment.id} className={`p-4 ${upcoming ? 'border-l-4 border-l-primary-500' : ''}`}>
            <div className="flex items-center justify-between">
              {/* Left: clock icon + date · time */}
              <div className="flex items-center space-x-3">
                <div className="flex items-center justify-center w-10 h-10 bg-primary-100 rounded-full flex-shrink-0">
                  <Clock className="h-5 w-5 text-primary-600" />
                </div>
                <div>
                  <p className="font-medium text-secondary-900">
                    {date} · {time}
                  </p>
                  {/* Tags row */}
                  <div className="flex items-center flex-wrap gap-2 mt-1">
                    {appointment.isSpecialistReferral && appointment.specialistType ? (
                      <StatusBadge
                        label={getSpecialistLabel(appointment.specialistType)}
                        colorClass="bg-purple-50 text-purple-700"
                        icon={<Stethoscope className="h-3 w-3 mr-1" />}
                      />
                    ) : (
                      <StatusBadge
                        label={appointment.appointmentType
                          ? appointment.appointmentType.charAt(0).toUpperCase() + appointment.appointmentType.slice(1)
                          : 'Consultation'}
                        colorClass="bg-primary-50 text-primary-700"
                      />
                    )}
                    <StatusBadge
                      label={appointment.status.charAt(0).toUpperCase() + appointment.status.slice(1)}
                      colorClass={getAppointmentStatusColor(appointment.status)}
                    />
                    {upcoming && (
                      <StatusBadge label="Upcoming" colorClass="bg-blue-50 text-blue-700" />
                    )}
                  </div>
                  {appointment.address && (
                    <p className="flex items-center text-xs text-secondary-500 mt-1">
                      <MapPin className="h-3 w-3 mr-1 flex-shrink-0" />
                      {appointment.address}
                    </p>
                  )}
                </div>
              </div>

              {/* Actions */}
                {/* Actions */}
                <div className="flex items-center space-x-2 ml-4 min-w-[150px] justify-end">
                    {(appointment.status === 'scheduled' || appointment.status === 'confirmed') ? (
                        <>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => onEditAppointment(appointment)}
                                className="flex items-center"
                            >
                                <Edit3 className="h-4 w-4 mr-1" />
                                Edit
                            </Button>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setCancelConfirmId(appointment.id)}
                                disabled={deletingId === appointment.id}
                                className="flex items-center text-red-600 hover:text-red-700"
                            >
                                {deletingId === appointment.id ? (
                                    <div className="h-4 w-4 mr-1 rounded-full border-2 border-current border-t-transparent animate-spin" />
                                ) : (
                                    <Trash2 className="h-4 w-4 mr-1" />
                                )}
                                Cancel
                            </Button>
                        </>
                    ) : (
                        // Empty placeholder to keep layout consistent
                        <div className="invisible flex space-x-2">
                            <Button variant="secondary" size="sm" className="flex items-center">
                                <Edit3 className="h-4 w-4 mr-1" />
                                Edit
                            </Button>
                            <Button variant="secondary" size="sm" className="flex items-center">
                                <Trash2 className="h-4 w-4 mr-1" />
                                Cancel
                            </Button>
                        </div>
                    )}
                </div>

            </div>
          </Card>
        );
      })}

      <PaginationBar
        currentPage={currentPage}
        pageSize={pageSize}
        totalItems={totalItems}
        hasMore={hasMore}
        onPreviousPage={() => handlePageChange(currentPage - 1)}
        onNextPage={() => handlePageChange(currentPage + 1)}
        label="appointments"
      />

      <ConfirmModal
        isOpen={!!cancelConfirmId}
        onClose={() => setCancelConfirmId(null)}
        onConfirm={() => cancelConfirmId && handleDeleteAppointment(cancelConfirmId)}
        title="Cancel Appointment"
        message="Are you sure you want to cancel this appointment?"
        confirmLabel="Cancel Appointment"
        variant="warning"
      />
    </div>
  );
};
