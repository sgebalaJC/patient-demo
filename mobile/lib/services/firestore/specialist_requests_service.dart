import 'package:cloud_firestore/cloud_firestore.dart';
import '../../models/specialist_request.dart';

class SpecialistRequestsService {
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  CollectionReference get _collection => _db.collection('specialist-requests');

  /// Create a specialist request
  Future<String> createRequest({
    required String patientId,
    required String specialistType,
    required String reason,
    String? notes,
  }) async {
    final data = <String, dynamic>{
      'patientId': patientId,
      'specialistType': specialistType,
      'reason': reason,
      'status': 'pending',
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    };
    if (notes != null && notes.isNotEmpty) {
      data['notes'] = notes;
    }

    final doc = await _collection.add(data);
    return doc.id;
  }

  /// Get specialist requests for a patient
  Future<List<SpecialistRequest>> getPatientRequests(String patientId) async {
    final snapshot = await _collection
        .where('patientId', isEqualTo: patientId)
        .orderBy('createdAt', descending: true)
        .get();

    return snapshot.docs
        .map((doc) => SpecialistRequest.fromFirestore(doc))
        .toList();
  }
}
