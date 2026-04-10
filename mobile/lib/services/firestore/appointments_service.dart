import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import '../../models/appointment.dart';
import '../../widgets/paginated_list.dart';

class AppointmentsService {
  final FirebaseFirestore _db = FirebaseFirestore.instance;
  final FirebaseFunctions _functions = FirebaseFunctions.instance;

  CollectionReference get _collection => _db.collection('appointments');

  static const int pageSize = 15;

  /// Get patient appointments with cursor-based pagination
  Future<PaginatedResult<Appointment>> getPatientAppointmentsPage(
    String patientId, {
    DocumentSnapshot? cursor,
    int limit = pageSize,
  }) async {
    Query query = _collection
        .where('patientId', isEqualTo: patientId)
        .orderBy('appointmentDate', descending: true)
        .limit(limit + 1);

    if (cursor != null) {
      query = query.startAfterDocument(cursor);
    }

    final snapshot = await query.get();
    final hasMore = snapshot.docs.length > limit;
    final docs = hasMore ? snapshot.docs.sublist(0, limit) : snapshot.docs;

    return PaginatedResult(
      items: docs.map((doc) => Appointment.fromFirestore(doc)).toList(),
      lastDoc: docs.isNotEmpty ? docs.last : null,
      hasMore: hasMore,
    );
  }

  /// Get patient appointments (non-paginated, for backward compat)
  Future<List<Appointment>> getPatientAppointments(
    String patientId, {
    int limit = 10,
    int page = 1,
  }) async {
    final snapshot = await _collection
        .where('patientId', isEqualTo: patientId)
        .orderBy('appointmentDate', descending: true)
        .limit(limit + (page - 1) * limit)
        .get();

    final docs = snapshot.docs.skip((page - 1) * limit).toList();
    return docs.map((doc) => Appointment.fromFirestore(doc)).toList();
  }

  /// Get upcoming appointments for patient
  Future<List<Appointment>> getUpcomingAppointments(String patientId) async {
    final snapshot = await _collection
        .where('patientId', isEqualTo: patientId)
        .where('appointmentDate', isGreaterThanOrEqualTo: Timestamp.now())
        .where('status', whereIn: ['scheduled', 'confirmed'])
        .orderBy('appointmentDate')
        .limit(10)
        .get();

    return snapshot.docs.map((doc) => Appointment.fromFirestore(doc)).toList();
  }

  /// Create appointment
  Future<String> createAppointment(Map<String, dynamic> data) async {
    data['createdAt'] = FieldValue.serverTimestamp();
    data['updatedAt'] = FieldValue.serverTimestamp();
    final doc = await _collection.add(data);
    return doc.id;
  }

  /// Update appointment
  Future<void> updateAppointment(
    String appointmentId,
    Map<String, dynamic> updates,
  ) async {
    updates['updatedAt'] = FieldValue.serverTimestamp();
    await _collection.doc(appointmentId).update(updates);
  }

  /// Get available appointment slots via Cloud Function
  Future<List<Map<String, dynamic>>> getAvailableSlots(String date) async {
    final result = await _functions
        .httpsCallable('getAvailableSlots')
        .call({'date': date});
    return List<Map<String, dynamic>>.from(result.data['slots'] ?? []);
  }

  /// Validate appointment slot via Cloud Function
  Future<bool> validateSlot(String date, String startTime) async {
    final result = await _functions
        .httpsCallable('validateAppointmentSlot')
        .call({'date': date, 'startTime': startTime});
    return result.data['available'] == true;
  }
}
