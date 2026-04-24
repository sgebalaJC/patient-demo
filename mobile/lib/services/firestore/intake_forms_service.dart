import 'package:cloud_firestore/cloud_firestore.dart';
import '../../models/intake_form.dart';

class IntakeFormsService {
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  CollectionReference get _collection => _db.collection('patient-intake-forms');

  /// Get the most recent intake form for a patient
  Future<PatientIntakeForm?> getPatientIntakeForm(String patientId) async {
    final snapshot = await _collection
        .where('patientId', isEqualTo: patientId)
        .orderBy('createdAt', descending: true)
        .limit(1)
        .get();

    if (snapshot.docs.isEmpty) return null;
    return PatientIntakeForm.fromFirestore(snapshot.docs.first);
  }

  /// Create a new draft intake form
  Future<String> createIntakeForm(String patientId) async {
    final doc = await _collection.add({
      'patientId': patientId,
      'status': 'draft',
      'completedSections': <String>[],
      'currentSection': 'patient-info',
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
    return doc.id;
  }

  /// Save a completed section
  Future<void> updateSection(
    String formId,
    String sectionName,
    Map<String, dynamic> sectionData,
  ) async {
    final formRef = _collection.doc(formId);
    final current = await formRef.get();
    final currentData = current.data() as Map<String, dynamic>?;
    final completedSections =
        List<String>.from(currentData?['completedSections'] ?? []);

    if (!completedSections.contains(sectionName)) {
      completedSections.add(sectionName);
    }

    await formRef.update({
      sectionName: sectionData,
      'completedSections': completedSections,
      'status': 'in_progress',
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  /// Update the current section navigation state
  Future<void> updateCurrentSection(String formId, String sectionId) async {
    await _collection.doc(formId).update({
      'currentSection': sectionId,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  /// Mark the entire form as completed
  Future<void> completeForm(String formId) async {
    await _collection.doc(formId).update({
      'status': 'completed',
      'completedAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  /// Dismiss the intake-form nag banner. Matches web's banner skip —
  /// writes `intakeFormSkipped: true` on the user doc so the prompt
  /// doesn't reappear on next launch.
  Future<void> markSkipped(String uid) async {
    await _db.collection('users').doc(uid).update({
      'intakeFormSkipped': true,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }
}
