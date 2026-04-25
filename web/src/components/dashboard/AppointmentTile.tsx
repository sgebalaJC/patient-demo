import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Appointment } from '../../types';
import { appointmentOperations } from '../../lib/firestore';
import { useAuth } from '../../hooks/useAuth';
import { Calendar, Clock, Plus, ArrowRight, User } from 'lucide-react';
import { Link } from 'react-router-dom';
import { BRANDING } from '../../config/branding';
import { toDate } from '../../lib/date-helpers';
import logger from '../../lib/logger';

interface AppointmentTileProps {
  onScheduleClick: () => void;
}

export const AppointmentTile: React.FC<AppointmentTileProps> = ({ onScheduleClick }) => {
  const { user } = useAuth();
  const [nextAppointment, setNextAppointment] = useState<Appointment | null>(null);
  const [upcomingCount, setUpcomingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchAppointments();
    }
  }, [user]);

  const fetchAppointments = async () => {
    if (!user) return;

    try {
      const response = await appointmentOperations.getUserAppointments(user.uid);

      if (response.success && response.data) {
        const now = new Date();
        const upcoming = response.data.appointments
          .filter((apt: Appointment) => toDate(apt.appointmentDate) > now && apt.status === 'scheduled')
          .sort(
            (a: Appointment, b: Appointment) =>
              toDate(a.appointmentDate).getTime() - toDate(b.appointmentDate).getTime(),
          );

        setUpcomingCount(upcoming.length);
        setNextAppointment(upcoming[0] || null);
      }
    } catch (error) {
      logger.error('Error fetching appointments:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatNextAppointment = (appointment: Appointment) => {
    const date = toDate(appointment.appointmentDate);

    const isToday = date.toDateString() === new Date().toDateString();
    const isTomorrow = date.toDateString() === new Date(Date.now() + 24 * 60 * 60 * 1000).toDateString();

    let dateText;
    if (isToday) {
      dateText = 'Today';
    } else if (isTomorrow) {
      dateText = 'Tomorrow';
    } else {
      dateText = date.toLocaleDateString('en-US', { 
        weekday: 'long',
        month: 'short', 
        day: 'numeric' 
      });
    }

    const timeText = date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });

    return `${dateText} at ${timeText}`;
  };

  if (loading) {
    return (
      <Card className="p-6">
        <div className="animate-pulse">
          <div className="flex items-center space-x-3 mb-4">
            <div className="bg-secondary-200 p-3 rounded-lg">
              <div className="h-8 w-8 bg-secondary-300 rounded"></div>
            </div>
            <div className="flex-1">
              <div className="h-6 bg-secondary-200 rounded mb-2"></div>
              <div className="h-4 bg-secondary-200 rounded w-2/3"></div>
            </div>
          </div>
          <div className="space-y-2">
            <div className="h-4 bg-secondary-200 rounded"></div>
            <div className="h-4 bg-secondary-200 rounded w-3/4"></div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 hover:shadow-lg transition-shadow">
      <div className="flex items-center space-x-3 mb-4">
        <div className="bg-primary-100 p-3 rounded-lg">
          <Calendar className="h-8 w-8 text-primary-600" />
        </div>
        <div className="flex-1">
          <h3 className="text-xl font-bold text-secondary-900">Appointments</h3>
          <p className="text-secondary-600">Schedule and manage your visits</p>
        </div>
      </div>

      {nextAppointment ? (
        <div className="space-y-4">
          {/* Next Appointment */}
          <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
            <div className="flex items-center space-x-2 text-primary-700 mb-2">
              <Clock className="h-4 w-4" />
              <span className="text-sm font-medium">Next Appointment</span>
            </div>
            <p className="font-semibold text-secondary-900 mb-1">
              {formatNextAppointment(nextAppointment)}
            </p>
            <div className="flex items-center space-x-2 text-sm text-secondary-600">
              <User className="h-4 w-4" />
              <span>
                {nextAppointment.appointmentType 
                  ? nextAppointment.appointmentType.charAt(0).toUpperCase() + nextAppointment.appointmentType.slice(1) + ' Appointment'
                  : 'Appointment'
                }
              </span>
            </div>
          </div>

          {/* Stats */}
          {upcomingCount > 1 && (
            <div className="text-sm text-secondary-600">
              <span className="font-medium">{upcomingCount}</span> upcoming appointments
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onScheduleClick}
              className="flex items-center"
            >
              <Plus className="h-4 w-4 mr-2" />
              Schedule New
            </Button>
            <Link to="/appointments">
              <Button variant="primary" size="sm" className="flex items-center">
                View All
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* No Appointments */}
          <div className="text-center py-6">
            <div className="bg-secondary-100 p-4 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
              <Calendar className="h-8 w-8 text-secondary-400" />
            </div>
            <h4 className="text-lg font-medium text-secondary-900 mb-2">No Upcoming Appointments</h4>
            <p className="text-secondary-600 text-sm">
              Schedule your first appointment with your {BRANDING.practiceType === 'concierge' ? 'concierge physician' : 'physician'}
            </p>
          </div>

          {/* Actions */}
          <div className="flex justify-center">
            <Button
              onClick={onScheduleClick}
              className="flex items-center"
              size="lg"
            >
              <Plus className="h-5 w-5 mr-2" />
              Schedule Appointment
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};
