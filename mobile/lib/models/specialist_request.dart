import 'package:cloud_firestore/cloud_firestore.dart';

enum SpecialistRequestStatus { pending, confirmed, cancelled }

class SpecialistRequest {
  final String id;
  final String patientId;
  final String specialistType;
  final String reason;
  final String? notes;
  final SpecialistRequestStatus status;
  final String? appointmentId;
  final DateTime? createdAt;

  SpecialistRequest({
    required this.id,
    required this.patientId,
    required this.specialistType,
    this.reason = '',
    this.notes,
    this.status = SpecialistRequestStatus.pending,
    this.appointmentId,
    this.createdAt,
  });

  factory SpecialistRequest.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;
    return SpecialistRequest(
      id: doc.id,
      patientId: data['patientId'] ?? '',
      specialistType: data['specialistType'] ?? '',
      reason: data['reason'] ?? '',
      notes: data['notes'],
      status: _parseStatus(data['status']),
      appointmentId: data['appointmentId'],
      createdAt: _parseTimestamp(data['createdAt']),
    );
  }

  static SpecialistRequestStatus _parseStatus(String? status) {
    switch (status) {
      case 'confirmed':
        return SpecialistRequestStatus.confirmed;
      case 'cancelled':
        return SpecialistRequestStatus.cancelled;
      default:
        return SpecialistRequestStatus.pending;
    }
  }

  static DateTime? _parseTimestamp(dynamic value) {
    if (value is Timestamp) return value.toDate();
    return null;
  }
}
