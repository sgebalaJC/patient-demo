import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../models/appointment.dart';
import '../../providers/auth_provider.dart';
import '../../services/firestore/appointments_service.dart';
import '../../services/firestore/notification_helper.dart';
import '../../config/colors.dart';
import '../../config/specialists.dart';
import '../../utils/date_formatting.dart';
import '../../widgets/status_chip.dart';

class AppointmentDetailScreen extends StatelessWidget {
  final Appointment appointment;

  const AppointmentDetailScreen({super.key, required this.appointment});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Appointment Details'),
        backgroundColor: AppColors.background,
        foregroundColor: AppColors.textDark,
        elevation: 0,
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Date & time card
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: AppColors.surfaceCard,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              children: [
                Container(
                  width: 60,
                  height: 60,
                  decoration: BoxDecoration(
                    color: AppColors.primary.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        '${appointment.appointmentDate.day}',
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.bold,
                          color: AppColors.primary,
                        ),
                      ),
                      Text(
                        monthAbbr(appointment.appointmentDate.month),
                        style: TextStyle(
                          fontSize: 12,
                          color: AppColors.primary,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        appointment.isSpecialistReferral && appointment.specialistType != null
                            ? getSpecialistLabel(appointment.specialistType!)
                            : _formatType(appointment.appointmentType),
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textDark,
                        ),
                      ),
                      if (appointment.isSpecialistReferral)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(
                              color: Colors.purple.withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: const Text(
                              'Specialist Referral',
                              style: TextStyle(fontSize: 11, color: Colors.purple, fontWeight: FontWeight.w500),
                            ),
                          ),
                        ),
                      const SizedBox(height: 4),
                      Text(
                        '${formatTime(appointment.appointmentDate)} — ${appointment.duration} min',
                        style: TextStyle(
                          fontSize: 14,
                          color: Colors.grey.shade600,
                        ),
                      ),
                    ],
                  ),
                ),
                StatusChip.appointment(appointment.status.name),
              ],
            ),
          ),
          const SizedBox(height: 12),

          // Details
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppColors.surfaceCard,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              children: [
                if (appointment.address != null)
                  _infoRow(Icons.location_on_outlined, 'Location',
                      appointment.address!),
                if (appointment.reason != null) ...[
                  if (appointment.address != null) const Divider(height: 24),
                  _infoRow(Icons.notes_outlined, 'Reason',
                      appointment.reason!),
                ],
                if (appointment.notes != null) ...[
                  if (appointment.reason != null || appointment.address != null)
                    const Divider(height: 24),
                  _infoRow(
                      Icons.edit_note, 'Notes', appointment.notes!),
                ],
                if (appointment.reason == null &&
                    appointment.notes == null &&
                    appointment.address == null)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Text('No additional details',
                        style: TextStyle(color: Colors.grey.shade500)),
                  ),
              ],
            ),
          ),

          // Cancel button (only for upcoming, non-cancelled)
          if (appointment.status == AppointmentStatus.scheduled ||
              appointment.status == AppointmentStatus.confirmed) ...[
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton(
                onPressed: () => _confirmCancel(context),
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.red,
                  side: const BorderSide(color: Colors.red),
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
                child: const Text('Cancel Appointment',
                    style: TextStyle(fontWeight: FontWeight.w600)),
              ),
            ),
          ],
        ],
      ),
    );
  }

  void _confirmCancel(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cancel Appointment'),
        content:
            const Text('Are you sure you want to cancel this appointment?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('No'),
          ),
          TextButton(
            onPressed: () async {
              Navigator.pop(ctx);
              await AppointmentsService()
                  .updateAppointment(appointment.id, {'status': 'cancelled'});

              final auth = context.read<AuthProvider>();
              final uid = auth.firebaseUser?.uid;
              if (uid != null) {
                final name = auth.userProfile?.fullName ?? 'Patient';
                final date = '${appointment.appointmentDate.month}/${appointment.appointmentDate.day}';
                NotificationHelper.notifyAdmins(
                  type: 'appointment_cancelled',
                  title: 'Appointment Cancelled',
                  message: '$name cancelled their appointment on $date',
                  patientId: uid,
                  extraMeta: {'appointmentId': appointment.id},
                );
              }

              if (context.mounted) Navigator.pop(context);
            },
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Yes, Cancel'),
          ),
        ],
      ),
    );
  }

  Widget _infoRow(IconData icon, String label, String value) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 18, color: Colors.grey.shade500),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label,
                  style:
                      TextStyle(fontSize: 12, color: Colors.grey.shade500)),
              const SizedBox(height: 2),
              Text(value,
                  style: TextStyle(color: AppColors.textDark)),
            ],
          ),
        ),
      ],
    );
  }

  String _formatType(AppointmentType type) {
    switch (type) {
      case AppointmentType.followUp:
        return 'Follow-up';
      case AppointmentType.physical:
        return 'Physical';
      case AppointmentType.urgent:
        return 'Urgent';
      default:
        return 'Consultation';
    }
  }

}
