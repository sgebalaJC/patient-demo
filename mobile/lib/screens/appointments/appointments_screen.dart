import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/auth_provider.dart';
import '../../services/firestore/appointments_service.dart';
import '../../models/appointment.dart';
import '../../config/colors.dart';
import '../../utils/date_formatting.dart';
import '../../widgets/paginated_list.dart';
import '../../widgets/status_chip.dart';
import 'book_appointment_sheet.dart';
import 'request_specialist_sheet.dart';
import 'appointment_detail_screen.dart';
import '../../widgets/page_header.dart';
import '../../config/specialists.dart';

class AppointmentsScreen extends StatefulWidget {
  final VoidCallback? onBack;
  const AppointmentsScreen({super.key, this.onBack});

  @override
  State<AppointmentsScreen> createState() => _AppointmentsScreenState();
}

class _AppointmentsScreenState extends State<AppointmentsScreen> {
  final _service = AppointmentsService();
  final _listKey = GlobalKey<PaginatedListState<Appointment>>();

  @override
  Widget build(BuildContext context) {
    final uid = context.read<AuthProvider>().firebaseUser?.uid;

    return Scaffold(
      backgroundColor: AppColors.background,
      body: Column(
        children: [
          PageHeader(
            icon: Icons.calendar_today,
            title: 'Appointments',
            subtitle: 'View and manage your visits',
            onBack: widget.onBack,
          ),
          Expanded(
            child: uid == null
                ? const SizedBox.shrink()
                : PaginatedList<Appointment>(
                    key: _listKey,
                    onLoad: (cursor) =>
                        _service.getPatientAppointmentsPage(uid, cursor: cursor),
                    itemBuilder: (context, apt) => _AppointmentTile(
                      appointment: apt,
                      onTap: () async {
                        await Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) =>
                                AppointmentDetailScreen(appointment: apt),
                          ),
                        );
                        _listKey.currentState?.refresh();
                      },
                    ),
                    emptyIcon: Icons.calendar_today,
                    emptyText: 'No appointments yet',
                  ),
          ),
        ],
      ),
      floatingActionButton: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          // Request specialist
          FloatingActionButton(
            heroTag: 'request',
            backgroundColor: Colors.purple,
            onPressed: () {
              RequestSpecialistSheet.show(context, onRequested: () {
                _listKey.currentState?.refresh();
              });
            },
            child: const Icon(Icons.medical_services_outlined, color: Colors.white),
          ),
          const SizedBox(height: 10),
          // Schedule appointment
          FloatingActionButton(
            heroTag: 'schedule',
            backgroundColor: AppColors.primary,
            onPressed: () {
              BookAppointmentSheet.show(context, onBooked: () {
                _listKey.currentState?.refresh();
              });
            },
            child: const Icon(Icons.add, color: Colors.white),
          ),
        ],
      ),
    );
  }
}

class _AppointmentTile extends StatelessWidget {
  final Appointment appointment;
  final VoidCallback? onTap;
  const _AppointmentTile({required this.appointment, this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surfaceCard,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  '${appointment.appointmentDate.day}',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: AppColors.primary,
                  ),
                ),
                Text(
                  monthAbbr(appointment.appointmentDate.month),
                  style: TextStyle(
                    fontSize: 11,
                    color: AppColors.primary,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  appointment.isSpecialistReferral && appointment.specialistType != null
                      ? getSpecialistLabel(appointment.specialistType!)
                      : _formatType(appointment.appointmentType),
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    color: AppColors.textDark,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '${appointment.duration} min',
                  style: TextStyle(fontSize: 13, color: Colors.grey.shade500),
                ),
                if (appointment.address != null) ...[
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Icon(Icons.location_on, size: 12, color: Colors.grey.shade500),
                      const SizedBox(width: 3),
                      Expanded(
                        child: Text(
                          appointment.address!,
                          style: TextStyle(fontSize: 12, color: Colors.grey.shade500),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                ] else if (appointment.reason != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    appointment.reason!,
                    style:
                        TextStyle(fontSize: 13, color: Colors.grey.shade500),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
          StatusChip.appointment(appointment.status.name),
        ],
      ),
    ),
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
