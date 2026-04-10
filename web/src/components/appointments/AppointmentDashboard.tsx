import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { AppointmentScheduler } from './AppointmentScheduler';
import { AppointmentList } from './AppointmentList';
import { SpecialistRequestModal } from './SpecialistRequestModal';
import { Appointment } from '../../types';
import { Calendar, Plus, ArrowLeft, Stethoscope } from 'lucide-react';

export const AppointmentDashboard: React.FC = () => {
  const [isSchedulerOpen, setIsSchedulerOpen] = useState(false);
  const [isRequestOpen, setIsRequestOpen] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleScheduleSuccess = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  const handleEditAppointment = (appointment: Appointment) => {
    setEditingAppointment(appointment);
    setIsSchedulerOpen(true);
  };

  const handleCloseScheduler = () => {
    setIsSchedulerOpen(false);
    setEditingAppointment(null);
  };

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
                <Calendar className="h-6 w-6 sm:h-8 sm:w-8 text-primary-600" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-2xl font-bold text-secondary-900 truncate">Appointments</h1>
                <p className="text-secondary-600 text-sm sm:text-base">
                  Schedule, manage, and track your appointments
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-2 w-full sm:w-auto">
            <Button
              onClick={() => setIsRequestOpen(true)}
              variant="secondary"
              className="flex items-center justify-center flex-1 sm:flex-initial border-purple-200 text-purple-700 hover:bg-purple-50"
              size="lg"
            >
              <Stethoscope className="h-4 w-4 sm:h-5 sm:w-5 mr-2" />
              Request
            </Button>
            <Button
              onClick={() => setIsSchedulerOpen(true)}
              className="flex items-center justify-center flex-1 sm:flex-initial"
              size="lg"
            >
              <Plus className="h-4 w-4 sm:h-5 sm:w-5 mr-2" />
              Schedule
            </Button>
          </div>
        </div>
      </Card>

      {/* Appointment List */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-secondary-900">Your Appointments</h2>
        </div>
        <AppointmentList 
          onEditAppointment={handleEditAppointment}
          refreshTrigger={refreshTrigger}
        />
      </div>

      {/* Scheduler Modal */}
      <AppointmentScheduler
        isOpen={isSchedulerOpen}
        onClose={handleCloseScheduler}
        onSuccess={handleScheduleSuccess}
        editingAppointment={editingAppointment}
      />

      {/* Specialist Request Modal */}
      <SpecialistRequestModal
        isOpen={isRequestOpen}
        onClose={() => setIsRequestOpen(false)}
        onSuccess={handleScheduleSuccess}
      />
    </div>
  );
};
