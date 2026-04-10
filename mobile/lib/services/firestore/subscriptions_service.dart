import 'package:cloud_firestore/cloud_firestore.dart';

/// Read-only service for patient subscription state.
///
/// Subscriptions are mirrored from Stripe by the `stripeWebhook` Cloud
/// Function. The mobile app only ever reads from Firestore — all mutations
/// (subscribe, cancel) happen via the web billing page, which the mobile
/// "Manage Membership" button opens in a browser.
class SubscriptionsService {
  static final _firestore = FirebaseFirestore.instance;

  /// Watch the current patient's subscription document. Emits null if the
  /// patient has never subscribed.
  static Stream<Map<String, dynamic>?> watch(String uid) {
    return _firestore
        .collection('patient-subscriptions')
        .doc(uid)
        .snapshots()
        .map((snap) => snap.exists ? snap.data() : null);
  }

  /// Read the subscription once.
  static Future<Map<String, dynamic>?> get(String uid) async {
    final snap =
        await _firestore.collection('patient-subscriptions').doc(uid).get();
    return snap.exists ? snap.data() : null;
  }
}
