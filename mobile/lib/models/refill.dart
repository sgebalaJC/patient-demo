import 'package:cloud_firestore/cloud_firestore.dart';

enum RefillStatus { pending, approved, denied, completed, cancelled }

enum RefillUrgency { routine, urgent, emergency }

class PrescriptionRefill {
  final String id;
  final String patientId;
  final String medicationName;
  final String? dosage;
  final String? quantity;
  final String? pharmacyName;
  final String? pharmacyAddress;
  final String? pharmacyPhone;
  final String? prescriptionNumber;
  final DateTime? originalPrescriptionDate;
  final DateTime? requestedDate;
  final RefillUrgency urgency;
  final RefillStatus status;
  final String? notes;
  final String? doctorNotes;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  PrescriptionRefill({
    required this.id,
    required this.patientId,
    required this.medicationName,
    this.dosage,
    this.quantity,
    this.pharmacyName,
    this.pharmacyAddress,
    this.pharmacyPhone,
    this.prescriptionNumber,
    this.originalPrescriptionDate,
    this.requestedDate,
    this.urgency = RefillUrgency.routine,
    this.status = RefillStatus.pending,
    this.notes,
    this.doctorNotes,
    this.createdAt,
    this.updatedAt,
  });

  factory PrescriptionRefill.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;
    return PrescriptionRefill(
      id: doc.id,
      patientId: data['patientId'] ?? '',
      medicationName: data['medicationName'] ?? '',
      dosage: data['dosage'],
      quantity: data['quantity'],
      pharmacyName: data['pharmacyName'],
      pharmacyAddress: data['pharmacyAddress'],
      pharmacyPhone: data['pharmacyPhone'],
      prescriptionNumber: data['prescriptionNumber'],
      originalPrescriptionDate:
          _parseTimestamp(data['originalPrescriptionDate']),
      requestedDate: _parseTimestamp(data['requestedDate']),
      urgency: _parseUrgency(data['urgency']),
      status: _parseStatus(data['status']),
      notes: data['notes'],
      doctorNotes: data['doctorNotes'],
      createdAt: _parseTimestamp(data['createdAt']),
      updatedAt: _parseTimestamp(data['updatedAt']),
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'patientId': patientId,
      'medicationName': medicationName,
      if (dosage != null) 'dosage': dosage,
      if (quantity != null) 'quantity': quantity,
      if (pharmacyName != null) 'pharmacyName': pharmacyName,
      if (pharmacyAddress != null) 'pharmacyAddress': pharmacyAddress,
      if (pharmacyPhone != null) 'pharmacyPhone': pharmacyPhone,
      if (prescriptionNumber != null) 'prescriptionNumber': prescriptionNumber,
      if (notes != null) 'notes': notes,
      'urgency': urgency.name,
      'status': status.name,
      'updatedAt': FieldValue.serverTimestamp(),
    };
  }

  static RefillStatus _parseStatus(String? status) {
    switch (status) {
      case 'approved':
        return RefillStatus.approved;
      case 'denied':
        return RefillStatus.denied;
      case 'completed':
        return RefillStatus.completed;
      case 'cancelled':
        return RefillStatus.cancelled;
      default:
        return RefillStatus.pending;
    }
  }

  static RefillUrgency _parseUrgency(String? urgency) {
    switch (urgency) {
      case 'urgent':
        return RefillUrgency.urgent;
      case 'emergency':
        return RefillUrgency.emergency;
      default:
        return RefillUrgency.routine;
    }
  }

  static DateTime? _parseTimestamp(dynamic value) {
    if (value is Timestamp) return value.toDate();
    return null;
  }
}
