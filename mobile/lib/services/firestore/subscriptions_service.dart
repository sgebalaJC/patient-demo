import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

class SubscriptionPlan {
  final String id;
  final String name;
  final String? description;
  final int amount;
  final String currency;
  final String interval;
  final bool active;
  final List<String> features;

  SubscriptionPlan({
    required this.id,
    required this.name,
    this.description,
    required this.amount,
    required this.currency,
    required this.interval,
    required this.active,
    required this.features,
  });

  factory SubscriptionPlan.fromDoc(DocumentSnapshot doc) {
    final d = doc.data() as Map<String, dynamic>;
    return SubscriptionPlan(
      id: doc.id,
      name: (d['name'] as String?) ?? 'Plan',
      description: d['description'] as String?,
      amount: (d['amount'] as num?)?.toInt() ?? 0,
      currency: (d['currency'] as String?) ?? 'usd',
      interval: (d['interval'] as String?) ?? 'month',
      active: d['active'] != false,
      features: (d['features'] as List?)?.whereType<String>().toList() ?? const [],
    );
  }
}

/// Patient-side subscriptions service.
///
/// Plan list + subscription state are read from Firestore. Mutations
/// (Stripe Checkout, cancel) go through Cloud Functions — Checkout still
/// completes on the web billing page since hosted Stripe Checkout is the
/// supported path.
class SubscriptionsService {
  static final _firestore = FirebaseFirestore.instance;
  static final _functions = FirebaseFunctions.instance;

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

  /// Available plans, ordered by price ascending. Active-only by default.
  static Future<List<SubscriptionPlan>> listPlans(
      {bool activeOnly = true}) async {
    final snap = await _firestore
        .collection('subscription-plans')
        .orderBy('amount')
        .get();
    final plans = snap.docs.map(SubscriptionPlan.fromDoc).toList();
    return activeOnly ? plans.where((p) => p.active).toList() : plans;
  }

  /// Cancel-at-period-end via Cloud Function. Subscription document updates
  /// asynchronously through the Stripe webhook.
  static Future<void> cancel() async {
    await _functions.httpsCallable('cancelSubscription').call({});
  }
}
