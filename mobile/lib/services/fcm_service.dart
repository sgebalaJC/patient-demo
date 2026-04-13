import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';

class FcmService {
  final FirebaseMessaging _messaging = FirebaseMessaging.instance;
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  /// Initialize FCM: request permission, register token, set up listeners.
  Future<void> initialize(String uid) async {
    // Request notification permission (iOS + Android 13+)
    final settings = await _messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );

    if (settings.authorizationStatus == AuthorizationStatus.denied) {
      debugPrint('[FCM] Notification permission denied');
      return;
    }

    // Get and store token
    await _registerToken(uid);

    // Listen for token refresh
    _messaging.onTokenRefresh.listen((newToken) {
      _saveToken(uid, newToken);
    });

    // Foreground messages — logged for now; the in-app Firestore listener
    // already handles real-time display
    FirebaseMessaging.onMessage.listen((message) {
      debugPrint('[FCM] Foreground message: ${message.notification?.title}');
    });
  }

  Future<void> _registerToken(String uid) async {
    try {
      final token = await _messaging.getToken();
      if (token != null) {
        await _saveToken(uid, token);
      }
    } catch (e) {
      debugPrint('[FCM] Failed to get token: $e');
    }
  }

  Future<void> _saveToken(String uid, String token) async {
    try {
      await _db.collection('users').doc(uid).update({
        'fcmToken': token,
        'fcmTokenUpdatedAt': FieldValue.serverTimestamp(),
      });
      debugPrint('[FCM] Token saved for user $uid');
    } catch (e) {
      debugPrint('[FCM] Failed to save token: $e');
    }
  }

  /// Remove FCM token on sign-out
  Future<void> clearToken(String uid) async {
    try {
      await _db.collection('users').doc(uid).update({
        'fcmToken': FieldValue.delete(),
        'fcmTokenUpdatedAt': FieldValue.delete(),
      });
    } catch (e) {
      debugPrint('[FCM] Failed to clear token: $e');
    }
  }
}
