import 'package:cloud_firestore/cloud_firestore.dart';

enum NotificationType {
  appointmentBooked,
  appointmentCancelled,
  appointmentConfirmed,
  newMessage,
  newPatient,
  refillRequest,
  system,
}

class AppNotification {
  final String id;
  final String recipientRole;
  final String? recipientId;
  final NotificationType type;
  final String title;
  final String message;
  final bool isRead;
  final Map<String, dynamic>? readBy;
  final Map<String, dynamic>? meta;
  final DateTime? createdAt;

  AppNotification({
    required this.id,
    required this.recipientRole,
    this.recipientId,
    required this.type,
    required this.title,
    required this.message,
    this.isRead = false,
    this.readBy,
    this.meta,
    this.createdAt,
  });

  bool isReadByUser(String userId) {
    return readBy?.containsKey(userId) ?? false;
  }

  factory AppNotification.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;
    return AppNotification(
      id: doc.id,
      recipientRole: data['recipientRole'] ?? 'patient',
      recipientId: data['recipientId'],
      type: _parseType(data['type']),
      title: data['title'] ?? '',
      message: data['message'] ?? '',
      isRead: data['isRead'] ?? false,
      readBy: data['readBy'] as Map<String, dynamic>?,
      meta: data['meta'] as Map<String, dynamic>?,
      createdAt: _parseTimestamp(data['createdAt']),
    );
  }

  static NotificationType _parseType(String? type) {
    switch (type) {
      case 'appointment_booked':
        return NotificationType.appointmentBooked;
      case 'appointment_cancelled':
        return NotificationType.appointmentCancelled;
      case 'appointment_confirmed':
        return NotificationType.appointmentConfirmed;
      case 'new_message':
        return NotificationType.newMessage;
      case 'new_patient':
        return NotificationType.newPatient;
      case 'refill_request':
        return NotificationType.refillRequest;
      default:
        return NotificationType.system;
    }
  }

  static DateTime? _parseTimestamp(dynamic value) {
    if (value is Timestamp) return value.toDate();
    return null;
  }
}
