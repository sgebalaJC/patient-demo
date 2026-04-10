import 'package:cloud_firestore/cloud_firestore.dart';
import '../../models/notification.dart';

class NotificationsService {
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  CollectionReference get _collection => _db.collection('notifications');

  /// Listen to patient notifications in real-time
  Stream<List<AppNotification>> patientNotificationsStream(String patientId) {
    return _collection
        .where('recipientRole', isEqualTo: 'patient')
        .where('recipientId', isEqualTo: patientId)
        .orderBy('createdAt', descending: true)
        .limit(50)
        .snapshots()
        .map((snapshot) => snapshot.docs
            .map((doc) => AppNotification.fromFirestore(doc))
            .toList());
  }

  /// Get patient notifications (one-time fetch)
  Future<List<AppNotification>> getPatientNotifications(String patientId) async {
    final snapshot = await _collection
        .where('recipientRole', isEqualTo: 'patient')
        .where('recipientId', isEqualTo: patientId)
        .orderBy('createdAt', descending: true)
        .limit(50)
        .get();

    return snapshot.docs
        .map((doc) => AppNotification.fromFirestore(doc))
        .toList();
  }

  /// Mark notification as read
  Future<void> markAsRead(String notificationId, String userId) async {
    await _collection.doc(notificationId).update({
      'readBy.$userId': FieldValue.serverTimestamp(),
      'isRead': true,
    });
  }

  /// Mark all notifications as read for user
  Future<void> markAllAsRead(String userId) async {
    final snapshot = await _collection
        .where('recipientRole', isEqualTo: 'patient')
        .where('recipientId', isEqualTo: userId)
        .get();

    final batch = _db.batch();
    for (final doc in snapshot.docs) {
      batch.update(doc.reference, {
        'readBy.$userId': FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
}
