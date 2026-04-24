import 'package:cloud_firestore/cloud_firestore.dart';

enum AppointmentStatus {
  scheduled,
  confirmed,
  inProgress,
  completed,
  cancelled,
  noShow,
}

enum AppointmentType {
  consultation,
  followUp,
  physical,
  urgent,
}

class Appointment {
  final String id;
  final String patientId;
  final DateTime appointmentDate;
  final int duration;
  final AppointmentType appointmentType;
  final String? reason;
  final String? notes;
  final AppointmentStatus status;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  // Specialist referral fields
  final String? specialistType;
  final String? address;
  final bool isSpecialistReferral;
  final String? specialistRequestId;

  Appointment({
    required this.id,
    required this.patientId,
    required this.appointmentDate,
    this.duration = 20, // keep in sync with branding.defaultAppointmentDuration
    this.appointmentType = AppointmentType.consultation,
    this.reason,
    this.notes,
    this.status = AppointmentStatus.scheduled,
    this.createdAt,
    this.updatedAt,
    this.specialistType,
    this.address,
    this.isSpecialistReferral = false,
    this.specialistRequestId,
  });

  factory Appointment.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;
    return Appointment(
      id: doc.id,
      patientId: data['patientId'] ?? '',
      appointmentDate: _parseTimestamp(data['appointmentDate']) ?? DateTime.now(),
      duration: data['duration'] ?? 20,
      appointmentType: _parseType(data['appointmentType']),
      reason: data['reason'],
      notes: data['notes'],
      status: _parseStatus(data['status']),
      createdAt: _parseTimestamp(data['createdAt']),
      updatedAt: _parseTimestamp(data['updatedAt']),
      specialistType: data['specialistType'],
      address: data['address'],
      isSpecialistReferral: data['isSpecialistReferral'] ?? false,
      specialistRequestId: data['specialistRequestId'],
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'patientId': patientId,
      'appointmentDate': Timestamp.fromDate(appointmentDate),
      'duration': duration,
      'appointmentType': appointmentType.name,
      'reason': reason,
      'notes': notes,
      'status': status.name,
      'updatedAt': FieldValue.serverTimestamp(),
    };
  }

  static AppointmentStatus _parseStatus(String? status) {
    switch (status) {
      case 'confirmed':
        return AppointmentStatus.confirmed;
      case 'in-progress':
        return AppointmentStatus.inProgress;
      case 'completed':
        return AppointmentStatus.completed;
      case 'cancelled':
        return AppointmentStatus.cancelled;
      case 'no-show':
        return AppointmentStatus.noShow;
      default:
        return AppointmentStatus.scheduled;
    }
  }

  static AppointmentType _parseType(String? type) {
    switch (type) {
      case 'follow-up':
        return AppointmentType.followUp;
      case 'physical':
        return AppointmentType.physical;
      case 'urgent':
        return AppointmentType.urgent;
      default:
        return AppointmentType.consultation;
    }
  }

  static DateTime? _parseTimestamp(dynamic value) {
    if (value is Timestamp) return value.toDate();
    return null;
  }
}
