import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:provider/provider.dart';
import '../../providers/auth_provider.dart';
import '../../services/firestore/appointments_service.dart';
import '../../services/firestore/notification_helper.dart';
import '../../config/branding.dart';
import '../../config/colors.dart';
import '../../widgets/bottom_sheet_header.dart';

class BookAppointmentSheet extends StatefulWidget {
  final VoidCallback? onBooked;

  const BookAppointmentSheet({super.key, this.onBooked});

  static Future<void> show(BuildContext context, {VoidCallback? onBooked}) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => BookAppointmentSheet(onBooked: onBooked),
    );
  }

  @override
  State<BookAppointmentSheet> createState() => _BookAppointmentSheetState();
}

class _BookAppointmentSheetState extends State<BookAppointmentSheet> {
  final _functions = FirebaseFunctions.instance;
  final _service = AppointmentsService();

  DateTime? _selectedDate;
  String? _selectedTime;
  String _appointmentType = 'consultation';
  List<Map<String, dynamic>> _slots = [];
  bool _loadingSlots = false;
  bool _submitting = false;
  String? _error;

  final _types = const {
    'consultation': 'Consultation',
    'follow-up': 'Follow-up',
    'physical': 'Physical',
    'urgent': 'Urgent',
  };

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: now.add(const Duration(days: 1)),
      firstDate: now.add(const Duration(days: 1)),
      lastDate: now.add(const Duration(days: 90)),
    );
    if (picked != null) {
      setState(() {
        _selectedDate = picked;
        _selectedTime = null;
        _error = null;
      });
      _loadSlots(picked);
    }
  }

  Future<void> _loadSlots(DateTime date) async {
    setState(() {
      _loadingSlots = true;
      _slots = [];
    });

    try {
      final dateStr =
          '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
      final result = await _functions
          .httpsCallable('getAvailableSlots')
          .call({'date': dateStr});

      final data = result.data as Map<String, dynamic>;
      if (data['success'] == true) {
        setState(() {
          _slots = List<Map<String, dynamic>>.from(data['slots'] ?? []);
        });
      }
    } catch (e) {
      // Fallback: show all slots as available
      setState(() {
        _slots = _generateFallbackSlots();
      });
    } finally {
      setState(() => _loadingSlots = false);
    }
  }

  List<Map<String, dynamic>> _generateFallbackSlots() {
    final slots = <Map<String, dynamic>>[];
    for (int hour = 9; hour <= 17; hour++) {
      for (final min in [0, 20, 40]) {
        if (hour == 17 && min > 40) continue;
        slots.add({
          'time': '${hour.toString().padLeft(2, '0')}:${min.toString().padLeft(2, '0')}',
          'available': true,
        });
      }
    }
    return slots;
  }

  Future<void> _submit() async {
    if (_selectedDate == null || _selectedTime == null) return;

    final auth = context.read<AuthProvider>();
    final uid = auth.firebaseUser?.uid;
    if (uid == null) return;

    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      // Parse time
      final parts = _selectedTime!.split(':');
      final appointmentDate = DateTime(
        _selectedDate!.year,
        _selectedDate!.month,
        _selectedDate!.day,
        int.parse(parts[0]),
        int.parse(parts[1]),
      );

      // Validate slot
      try {
        final validation = await _functions
            .httpsCallable('validateAppointmentSlot')
            .call({'appointmentDate': appointmentDate.toIso8601String()});
        final vData = validation.data as Map<String, dynamic>;
        if (vData['available'] != true) {
          setState(() {
            _error = vData['reason'] as String? ??
                'This slot is no longer available';
            _submitting = false;
          });
          return;
        }
      } catch (_) {
        // If validation fails, proceed anyway
      }

      // Create appointment
      await _service.createAppointment({
        'patientId': uid,
        'appointmentDate': Timestamp.fromDate(appointmentDate),
        'appointmentType': _appointmentType,
        'duration': branding.defaultAppointmentDuration,
        'status': 'scheduled',
        'reminderSent': false,
      });

      // Create notification for admin
      await NotificationHelper.notifyAdmins(
        type: 'appointment_booked',
        title: 'New Appointment',
        message:
            '${auth.userProfile?.fullName ?? 'Patient'} booked ${_types[_appointmentType]} on ${_selectedDate!.month}/${_selectedDate!.day} at ${_formatTime(_selectedTime!)}',
        patientId: uid,
      );

      if (mounted) {
        Navigator.pop(context);
        widget.onBooked?.call();
      }
    } catch (e) {
      setState(() {
        _error = 'Failed to book appointment';
        _submitting = false;
      });
    }
  }

  String _formatTime(String time24) {
    final parts = time24.split(':');
    final hour = int.parse(parts[0]);
    final min = parts[1];
    final h = hour > 12 ? hour - 12 : (hour == 0 ? 12 : hour);
    final amPm = hour >= 12 ? 'PM' : 'AM';
    return '$h:$min $amPm';
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Container(
      padding: EdgeInsets.only(bottom: bottomInset),
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.85,
      ),
      decoration: BoxDecoration(
        color: AppColors.surfaceCard,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            BottomSheetHeader(
              icon: Icons.calendar_today,
              color: AppColors.primary,
              title: 'Book Appointment',
            ),

            // Scrollable content
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Error
                    if (_error != null) ...[
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.red.shade50,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(_error!,
                            style: TextStyle(
                                color: Colors.red.shade700, fontSize: 14)),
                      ),
                      const SizedBox(height: 16),
                    ],

                    // Appointment type
                    Text('Type',
                        style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                            color: AppColors.textMedium)),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      children: _types.entries.map((e) {
                        final selected = _appointmentType == e.key;
                        return ChoiceChip(
                          label: Text(e.value),
                          selected: selected,
                          selectedColor:
                              AppColors.primary.withValues(alpha: 0.15),
                          onSelected: (_) =>
                              setState(() => _appointmentType = e.key),
                        );
                      }).toList(),
                    ),
                    const SizedBox(height: 20),

                    // Date picker
                    Text('Date',
                        style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                            color: AppColors.textMedium)),
                    const SizedBox(height: 8),
                    GestureDetector(
                      onTap: _pickDate,
                      child: Container(
                        width: double.infinity,
                        padding: const EdgeInsets.symmetric(
                            horizontal: 14, vertical: 14),
                        decoration: BoxDecoration(
                          border: Border.all(color: Colors.grey.shade300),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Row(
                          children: [
                            Icon(Icons.calendar_today,
                                size: 18, color: Colors.grey.shade500),
                            const SizedBox(width: 10),
                            Text(
                              _selectedDate != null
                                  ? '${_selectedDate!.month}/${_selectedDate!.day}/${_selectedDate!.year}'
                                  : 'Select a date',
                              style: TextStyle(
                                color: _selectedDate != null
                                    ? AppColors.textDark
                                    : Colors.grey.shade400,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 20),

                    // Time slots
                    if (_selectedDate != null) ...[
                      Text('Time',
                          style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w500,
                              color: AppColors.textMedium)),
                      const SizedBox(height: 8),
                      if (_loadingSlots)
                        const Center(
                          child: Padding(
                            padding: EdgeInsets.all(20),
                            child: CircularProgressIndicator(),
                          ),
                        )
                      else
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: _slots.map((slot) {
                            final time = slot['time'] as String;
                            final available = slot['available'] as bool;
                            final selected = _selectedTime == time;
                            return GestureDetector(
                              onTap: available
                                  ? () => setState(() {
                                        _selectedTime = time;
                                        _error = null;
                                      })
                                  : null,
                              child: Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 14, vertical: 10),
                                decoration: BoxDecoration(
                                  color: selected
                                      ? AppColors.primary
                                      : available
                                          ? AppColors.surfaceCard
                                          : Colors.grey.shade100,
                                  border: Border.all(
                                    color: selected
                                        ? AppColors.primary
                                        : available
                                            ? Colors.grey.shade300
                                            : Colors.grey.shade200,
                                  ),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Text(
                                  _formatTime(time),
                                  style: TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w500,
                                    color: selected
                                        ? Colors.white
                                        : available
                                            ? AppColors.textDark
                                            : Colors.grey.shade400,
                                  ),
                                ),
                              ),
                            );
                          }).toList(),
                        ),
                      const SizedBox(height: 24),
                    ],

                    // Submit
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        onPressed: _selectedDate != null &&
                                _selectedTime != null &&
                                !_submitting
                            ? _submit
                            : null,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.primary,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10),
                          ),
                        ),
                        child: _submitting
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(
                                    strokeWidth: 2, color: Colors.white),
                              )
                            : const Text('Book Appointment',
                                style: TextStyle(
                                    fontSize: 16, fontWeight: FontWeight.w600)),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
