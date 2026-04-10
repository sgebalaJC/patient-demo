import 'package:cloud_firestore/cloud_firestore.dart';

class NotificationHelper {
  static Future<void> notifyAdmins({
    required String type,
    required String title,
    required String message,
    required String patientId,
    Map<String, String>? extraMeta,
  }) async {
    final meta = <String, String>{'patientId': patientId};
    if (extraMeta != null) meta.addAll(extraMeta);

    await FirebaseFirestore.instance.collection('notifications').add({
      'recipientRole': 'admin',
      'type': type,
      'title': title,
      'message': message,
      'isRead': false,
      'readBy': {},
      'meta': meta,
      'createdAt': FieldValue.serverTimestamp(),
    });
  }
}
