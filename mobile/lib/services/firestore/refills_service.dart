import 'package:cloud_firestore/cloud_firestore.dart';
import '../../models/refill.dart';
import '../../widgets/paginated_list.dart';

class RefillsService {
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  CollectionReference get _collection => _db.collection('prescription-refills');

  static const int pageSize = 15;

  /// Get patient's refill requests with cursor-based pagination
  Future<PaginatedResult<PrescriptionRefill>> getPatientRefillsPage(
    String patientId, {
    DocumentSnapshot? cursor,
    int limit = pageSize,
  }) async {
    Query query = _collection
        .where('patientId', isEqualTo: patientId)
        .orderBy('createdAt', descending: true)
        .limit(limit + 1);

    if (cursor != null) {
      query = query.startAfterDocument(cursor);
    }

    final snapshot = await query.get();
    final hasMore = snapshot.docs.length > limit;
    final docs = hasMore ? snapshot.docs.sublist(0, limit) : snapshot.docs;

    return PaginatedResult(
      items: docs.map((doc) => PrescriptionRefill.fromFirestore(doc)).toList(),
      lastDoc: docs.isNotEmpty ? docs.last : null,
      hasMore: hasMore,
    );
  }

  /// Get patient's refill requests (non-paginated, for backward compat)
  Future<List<PrescriptionRefill>> getPatientRefills(
    String patientId, {
    int limit = 20,
  }) async {
    final snapshot = await _collection
        .where('patientId', isEqualTo: patientId)
        .orderBy('createdAt', descending: true)
        .limit(limit)
        .get();

    return snapshot.docs
        .map((doc) => PrescriptionRefill.fromFirestore(doc))
        .toList();
  }

  /// Create a refill request
  Future<String> createRefillRequest({
    required String patientId,
    required String medicationName,
    String? dosage,
    String? quantity,
    String? pharmacyName,
    String? pharmacyAddress,
    String? pharmacyPhone,
    String? prescriptionNumber,
    String urgency = 'routine',
    String? notes,
  }) async {
    final doc = await _collection.add({
      'patientId': patientId,
      'medicationName': medicationName,
      'dosage': dosage,
      'quantity': quantity,
      'pharmacyName': pharmacyName,
      'pharmacyAddress': pharmacyAddress,
      'pharmacyPhone': pharmacyPhone,
      'prescriptionNumber': prescriptionNumber,
      'urgency': urgency,
      'status': 'pending',
      'notes': notes,
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
    return doc.id;
  }

  /// Update a refill request
  Future<void> updateRefill(
      String refillId, Map<String, dynamic> updates) async {
    updates['updatedAt'] = FieldValue.serverTimestamp();
    await _collection.doc(refillId).update(updates);
  }

  /// Delete a refill request
  Future<void> deleteRefill(String refillId) async {
    await _collection.doc(refillId).delete();
  }

  /// Get a single refill by ID
  Future<PrescriptionRefill?> getRefillById(String refillId) async {
    final doc = await _collection.doc(refillId).get();
    if (!doc.exists) return null;
    return PrescriptionRefill.fromFirestore(doc);
  }
}
